"use client";

import React from 'react';

export default function DashboardClient() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <div className="w-full max-w-xl rounded-xl border border-zinc-200 bg-white p-8 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <span className="inline-flex items-center rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
          Micro-SaaS Analytics
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
          Analytics Engine Initialized
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Core application shell and layout tree active. Ready for Phase 4 dependency sync.
        </p>
      </div>
    </main>
  );
}
