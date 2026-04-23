// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Structured logging utility for Cloudflare Workers.
 * 
 * Implements the "wide events" pattern (canonical log lines):
 * - Emit a single, context-rich structured event per request per service
 * - Include high-cardinality fields (user IDs, request IDs)
 * - Include high-dimensionality (20-100+ fields per event)
 * - Use JSON format for queryability
 * 
 * Only two log levels:
 * - "info": normal operations, all wide events
 * - "error": unexpected failures needing attention
 */

export interface LogFields {
	[key: string]: unknown;
}

export interface WideEvent extends LogFields {
	level: "info" | "error";
	msg: string;
	timestamp: string;
	requestId?: string;
	method?: string;
	path?: string;
	status?: number;
	durationMs?: number;
	error?: string;
	stack?: string;
}

/**
 * Structured logger that outputs JSON for Cloudflare Workers.
 * No external dependencies - works within Worker constraints.
 */
export class Logger {
	private baseFields: LogFields;

	constructor(baseFields: LogFields = {}) {
		this.baseFields = baseFields;
	}

	/**
	 * Log an info-level event (normal operations).
	 * Use for wide events - the primary logging pattern.
	 */
	info(msg: string, fields: LogFields = {}): void {
		this.log("info", msg, fields);
	}

	/**
	 * Log an error-level event (unexpected failures).
	 * Use when something needs attention.
	 */
	error(msg: string, fields: LogFields = {}): void {
		this.log("error", msg, fields);
	}

	/**
	 * Log a wide event with full request context.
	 * This is the primary pattern - single event per request with all context.
	 */
	wideEvent(event: Omit<WideEvent, "timestamp">): void {
		this.log(event.level, event.msg, {
			...event,
			level: undefined,
			msg: undefined,
		});
	}

	/**
	 * Create a child logger with additional base fields.
	 */
	child(additionalFields: LogFields): Logger {
		return new Logger({ ...this.baseFields, ...additionalFields });
	}

	private log(level: "info" | "error", msg: string, fields: LogFields): void {
		const entry = {
			level,
			msg,
			timestamp: new Date().toISOString(),
			...this.baseFields,
			...fields,
		};
		// Remove undefined values for cleaner output
		const cleaned = Object.fromEntries(
			Object.entries(entry).filter(([, v]) => v !== undefined)
		);
		
		if (level === "error") {
			console.error(JSON.stringify(cleaned));
		} else {
			console.log(JSON.stringify(cleaned));
		}
	}
}

/**
 * Default logger instance for the application.
 */
export const logger = new Logger();

/**
 * Generate a request ID for correlation.
 */
export function generateRequestId(): string {
	return crypto.randomUUID();
}
