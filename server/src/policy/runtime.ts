import {
  evaluatePolicy,
  sha256Canonical
} from "@planipus/calendar-sync";
import type {
  JsonValue,
  PolicyEvaluationInput,
  PolicyEvaluationResult
} from "@planipus/calendar-sync";

export interface PolicyRuntime {
  evaluate(input: PolicyEvaluationInput): PolicyEvaluationResult;
  hash(value: unknown): string;
}

export const sharedPolicyRuntime: PolicyRuntime = {
  evaluate(input: PolicyEvaluationInput): PolicyEvaluationResult {
    return evaluatePolicy(input);
  },
  hash(value: unknown): string {
    return sha256Canonical(value as JsonValue);
  }
};
