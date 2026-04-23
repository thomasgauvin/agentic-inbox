// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Minimal structured logger for Cloudflare Workers.
 *
 * Outputs single-line JSON so that log platforms can parse level, message,
 * and arbitrary metadata without regex gymnastics.
 *
 * Usage:
 *   log("info", "email_received", { mailboxId, sender, subject });
 *   logError("auto-draft failed", e, { mailboxId, emailId });
 */

export type LogLevel = "info" | "warn" | "error";

function write(level: LogLevel, message: string, meta?: Record<string, unknown>) {
	const entry: Record<string, unknown> = {
		level,
		message,
		timestamp: new Date().toISOString(),
		...meta,
	};
	const line = JSON.stringify(entry);
	if (level === "error") console.error(line);
	else if (level === "warn") console.warn(line);
	else console.log(line);
}

export function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
	write(level, message, meta);
}

export function logInfo(message: string, meta?: Record<string, unknown>) {
	write("info", message, meta);
}

export function logWarn(message: string, meta?: Record<string, unknown>) {
	write("warn", message, meta);
}

export function logError(message: string, error: unknown, meta?: Record<string, unknown>) {
	const errorMeta: Record<string, unknown> =
		typeof error === "object" && error !== null
			? {
					errorMessage: (error as Error).message,
					errorName: (error as Error).name,
					errorStack: (error as Error).stack,
					...meta,
				}
			: { errorMessage: String(error), ...meta };
	write("error", message, errorMeta);
}
