import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { FieldError } from "@/lib/collection/validate";
import { GatewayUnreachableError } from "@/lib/collection/client";
import { classify, codeMessage, customerMessage } from "@/lib/collection/codes";

export interface ApiOk<T = unknown> {
  ok: true;
  data: T;
}

export interface ApiErr {
  ok: false;
  /** Gateway response code when there is one, else an app-level slug. */
  code: string;
  /** Safe to show a customer. */
  message: string;
  /** Present when the outcome is unknown — the UI must not say "failed". */
  indeterminate?: boolean;
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiOk<T>>({ ok: true, data }, init);
}

export function err(
  code: string,
  message: string,
  status = 400,
  indeterminate = false,
) {
  return NextResponse.json<ApiErr>(
    { ok: false, code, message, ...(indeterminate ? { indeterminate: true } : {}) },
    { status },
  );
}

/**
 * One place to turn a thrown error into a response. Note the deliberate
 * asymmetry: a gateway we could not reach becomes an *indeterminate* 202, not a
 * 5xx failure — the request may have been processed on the other side.
 */
export function handleRouteError(error: unknown) {
  if (error instanceof ZodError) {
    return err("BAD_REQUEST", error.issues[0]?.message ?? "Invalid request", 422);
  }
  if (error instanceof FieldError) {
    return err(error.code, `${codeMessage(error.code)} (${error.field})`, 422);
  }
  if (error instanceof GatewayUnreachableError) {
    return err(
      "0037",
      customerMessage("0037"),
      202,
      true,
    );
  }
  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    return err("UNAUTHENTICATED", "Please sign in to continue.", 401);
  }
  console.error("[api]", error);
  return err("INTERNAL", "Something went wrong. Please try again.", 500);
}

/** Shapes a gateway call into the response the UI reads. */
export function fromGateway<T extends Record<string, unknown>>(
  code: string,
  extra: T,
) {
  const outcome = classify(code);
  return ok({
    code,
    outcome,
    message: customerMessage(code),
    gatewayMessage: codeMessage(code),
    ...extra,
  });
}
