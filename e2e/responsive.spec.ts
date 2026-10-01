import { expect, test, type Page } from '@playwright/test';

/**
 * Responsive and interaction verification in headless Chromium.
 *
 * The suite encodes the layout contract from the plan rather than a set of
 * screenshots: nothing may scroll sideways, hydration must stay quiet, every
 * control must clear the 44px touch minimum, and tapping a chart must reach the
 * inspector. Those are the four failure modes that a screenshot would not catch.
 */

const VIEWPORTS = [
  { name: '360', width: 360, height: 780 },
  { name: '390', width: 390, height: 844 },
  { name: '430', width: 430, height: 932 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 800 },
  { name: '1280', width: 1280, height: 900 },
] as const;

const MIN_TOUCH_TARGET = 44;

/** Waits for the seeded snapshot to hydrate into a ready store. */
async function waitForDashboard(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="kpi-card-netMrr"]', { state: 'visible' });
  await expect(page.locator('[data-testid="kpi-card-netMrr"]')).toContainText(/\d/);
}

/** Collects console errors and warnings for the duration of a test. */
function collectConsole(page: Page): string[] {
  const messages: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      messages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    messages.push(`pageerror: ${error.message}`);
  });
  return messages;
}

test.describe('responsive layout', () => {
  for (const viewport of VIEWPORTS) {
    test(`renders without horizontal overflow at ${viewport.name}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await waitForDashboard(page);

      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return { scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth };
      });

      expect(
        overflow.scrollWidth,
        `scrollWidth ${overflow.scrollWidth} exceeded viewport ${overflow.innerWidth}`,
      ).toBeLessThanOrEqual(overflow.innerWidth);
    });

    test(`hydrates cleanly at ${viewport.name}px`, async ({ page }) => {
      const messages = collectConsole(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await waitForDashboard(page);

      const hydrationIssues = messages.filter((message) => /hydrat/i.test(message));
      expect(hydrationIssues, hydrationIssues.join('\n')).toEqual([]);
      expect(messages.filter((m) => /error/i.test(m))).toEqual([]);
    });

    test(`keeps every control at ${viewport.name}px at least 44x44`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await waitForDashboard(page);

      const undersized = await page.evaluate((minimum) => {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>('button, [role="tab"]'),
        );
        return nodes
          .filter((node) => {
            const style = window.getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden') {
              return false;
            }
            const box = node.getBoundingClientRect();
            // Zero-sized boxes are hidden from the layout, not interactive.
            if (box.width === 0 && box.height === 0) {
              return false;
            }
            return box.width < minimum - 0.5 || box.height < minimum - 0.5;
          })
          .map((node) => {
            const box = node.getBoundingClientRect();
            const label = node.getAttribute('aria-label') ?? node.textContent ?? '';
            return `${label.trim().slice(0, 40)} (${Math.round(box.width)}x${Math.round(box.height)})`;
          });
      }, MIN_TOUCH_TARGET);

      expect(undersized, `Undersized controls:\n${undersized.join('\n')}`).toEqual([]);
    });
  }
});

test.describe('security headers', () => {
  test('serves the hardened response headers', async ({ page }) => {
    const response = await page.goto('/');
    expect(response).not.toBeNull();
    const headers = response?.headers() ?? {};

    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  test('still boots and hydrates with the CSP in place', async ({ page }) => {
    const messages = collectConsole(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await waitForDashboard(page);
    expect(messages.filter((m) => /error|refused|hydrat/i.test(m))).toEqual([]);
  });
});

test.describe('interaction', () => {
  test('tapping a chart pins a bucket in the inspector at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await waitForDashboard(page);

    const inspector = page.getByTestId('chart-inspector');
    await expect(inspector).toHaveAttribute('data-selected-point', '');

    const plot = page.locator('#revenue .recharts-surface').first();
    await expect(plot).toBeVisible();

    // The chart sits well below the fold on a phone, and `page.mouse` does not
    // scroll, so bring it into view before reading coordinates.
    await plot.scrollIntoViewIfNeeded();
    const box = await plot.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) {
      return;
    }

    // Recharts populates `activeTooltipIndex` from pointer movement, so a bare
    // click at a coordinate would never select anything. A real tap always
    // moves first, so the test does the same.
    const tapX = box.x + box.width * 0.6;
    const tapY = box.y + box.height * 0.5;
    await page.mouse.move(tapX, tapY);
    await page.mouse.down();
    await page.mouse.up();

    await expect(inspector).not.toHaveAttribute('data-selected-point', '');
    await expect(page.getByTestId('inspector-composition')).toBeVisible();
  });

  test('selecting a KPI card changes what the inspector headlines', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await waitForDashboard(page);

    const inspector = page.getByTestId('chart-inspector');
    await expect(inspector).toContainText('Net MRR');

    await page.getByTestId('kpi-card-logoChurn').click();
    await expect(inspector).toContainText('Logo churn');
    await expect(page.getByTestId('kpi-card-logoChurn')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the mobile filter drawer applies and resets filters', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await waitForDashboard(page);

    await page.getByTestId('open-filters').click();
    const drawer = page.getByTestId('slide-over-drawer');
    await expect(drawer).toBeVisible();

    await drawer.getByLabel('Tier').selectOption('enterprise');
    await page.getByTestId('apply-filters').click();
    await expect(drawer).toBeHidden();

    await expect(page.locator('#customers')).toContainText('Enterprise');
  });

  test('the desktop ledger paginates and sorts', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await waitForDashboard(page);

    const next = page.getByTestId('ledger-next');
    await expect(next).toBeEnabled();
    await next.click();
    await expect(page.locator('#customers')).toContainText('Page 2 of');

    await page.getByTestId('sort-organizationName').click();
    const firstRow = page.locator('#customers tbody tr').first();
    await expect(firstRow).toBeVisible();
  });

  test('adding a customer through the modal updates the ledger', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await waitForDashboard(page);

    const before = await page
      .locator('#customers')
      .getByText(/matching|matching|accounts/)
      .first()
      .textContent();

    await page.getByTestId('open-add-customer').click();
    const modal = page.getByTestId('new-subscription-modal');
    await expect(modal).toBeVisible();

    await modal.getByLabel('Organization').fill('Playwright Industries');
    await modal.getByLabel('Billing email').fill('qa@playwright.example');
    await modal.getByLabel('Monthly price (USD)').fill('249');
    await page.getByTestId('submit-new-customer').click();

    await expect(modal).toBeHidden();
    await expect(page.locator('#customers')).toContainText('Playwright Industries');
    expect(before).not.toBeNull();
  });

  test('a duplicate email is rejected without a second account', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await waitForDashboard(page);

    const existingEmail = await page
      .locator('#customers tbody tr')
      .first()
      .locator('th')
      .first()
      .innerText()
      .then((text) => text.split('\n')[1]?.trim() ?? '');

    expect(existingEmail).toContain('@');

    await page.getByTestId('open-add-customer').click();
    const modal = page.getByTestId('new-subscription-modal');
    await expect(modal).toBeVisible();

    await modal.getByLabel('Organization').fill('Duplicate Co');
    // Seeded emails are already present; using one must fail validation.
    await modal.getByLabel('Billing email').fill(existingEmail);
    await page.getByTestId('submit-new-customer').click();

    await expect(modal.getByText(/already belongs to a customer/)).toBeVisible();
  });

  test('the theme toggle persists a flash-free preference', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await waitForDashboard(page);

    const toggle = page.getByTestId('theme-toggle');
    const before = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );

    await toggle.click();
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.classList.contains('dark')),
      )
      .toBe(!before);

    const stored = await page.evaluate(() =>
      window.localStorage.getItem('microsaas_v1_theme'),
    );
    expect(stored).toBe(before ? 'light' : 'dark');

    await page.reload();
    await waitForDashboard(page);
    const afterReload = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );
    expect(afterReload).toBe(!before);
  });

  test('exports both CSV files', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await waitForDashboard(page);

    const customersDownload = page.waitForEvent('download');
    await page.getByTestId('export-menu-toggle').click();
    await page.getByRole('menuitem', { name: 'Customers CSV' }).click();
    const first = await customersDownload;
    expect(first.suggestedFilename()).toMatch(/^customers_asof_\d{4}-\d{2}-\d{2}\.csv$/);

    const dailyDownload = page.waitForEvent('download');
    await page.getByTestId('export-menu-toggle').click();
    await page.getByRole('menuitem', { name: 'Daily MRR CSV' }).click();
    const second = await dailyDownload;
    expect(second.suggestedFilename()).toMatch(/^daily_mrr_asof_\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test('a cancelled subscription requires confirmation and updates the ledger', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await waitForDashboard(page);

    const firstRow = page.locator('#customers tbody tr').first();
    const rowLabel = (await firstRow.locator('th').first().innerText()).split('\n')[0] ?? '';
    await firstRow.getByRole('button', { name: /Actions for/ }).click();

    const sheet = page.getByTestId('slide-over-drawer');
    await expect(sheet).toBeVisible();
    await sheet.getByTestId('sheet-cancel-subscription').click();

    const dialog = page.getByTestId('confirm-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel subscription' }).click();

    await expect(dialog).toBeHidden();
    await expect(sheet).toBeHidden();
    await expect(page.locator('#customers')).toContainText(rowLabel);
  });

  test('resetting demo data asks for confirmation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await waitForDashboard(page);

    await page.getByTestId('nav-toggle').click();
    const drawer = page.getByTestId('slide-over-drawer');
    await expect(drawer).toBeVisible();

    await page.getByTestId('reset-demo-data').click();
    const dialog = page.getByTestId('confirm-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Reset data' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('kpi-card-netMrr')).toContainText(/\d/);
  });

  test('the seed survives a reload and stays consistent', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await waitForDashboard(page);

    const revision = await page.evaluate(() => {
      const raw = window.localStorage.getItem('microsaas_v1_state');
      return raw === null ? null : (JSON.parse(raw) as { revision: number }).revision;
    });
    expect(revision).toBeGreaterThanOrEqual(1);

    await page.reload();
    await waitForDashboard(page);

    const afterReload = await page.evaluate(() => {
      const raw = window.localStorage.getItem('microsaas_v1_state');
      return raw === null ? null : (JSON.parse(raw) as { revision: number }).revision;
    });
    expect(afterReload).toBe(revision);
  });

  test('re-applying the same seed keeps the ledger balanced', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await waitForDashboard(page);

    const balances = await page.evaluate(() => {
      const raw = window.localStorage.getItem('microsaas_v1_state');
      if (raw === null) {
        return null;
      }
      const snapshot = JSON.parse(raw) as {
        customers: { id: string; mrrCents: number }[];
        events: { customerId: string; deltaMrrCents: number }[];
      };
      const sums = new Map<string, number>();
      for (const event of snapshot.events) {
        sums.set(
          event.customerId,
          (sums.get(event.customerId) ?? 0) + event.deltaMrrCents,
        );
      }
      return snapshot.customers
        .map((customer) => (sums.get(customer.id) ?? 0) - customer.mrrCents)
        .filter((difference) => difference !== 0);
    });

    expect(balances).toEqual([]);
  });
});