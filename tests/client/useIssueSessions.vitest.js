import { afterEach, describe, expect, it, vi } from "vitest";

import { useIssueSessions } from "../../src/composables/useIssueSessions.js";
import { issueSessionFacts } from "../../src/lib/issueSessionViewModel.js";
import {
  listIssueSessions,
  readIssueSession,
  rewindIssueSession
} from "@/lib/studioApi.js";

vi.mock("@/lib/studioApi.js", () => ({
  abandonIssueSession: vi.fn(),
  createIssueSession: vi.fn(),
  listIssueSessions: vi.fn(),
  readIssueSession: vi.fn(),
  rewindIssueSession: vi.fn(),
  runIssueSessionStep: vi.fn()
}));

describe("useIssueSessions", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("patches late session fields into the selected session and visible list", async () => {
    const session = {
      currentStep: "prompt",
      sessionId: "2026-05-12_13-07-36",
      status: "running",
      worktreeReady: true
    };
    listIssueSessions.mockResolvedValue({
      sessions: [session]
    });
    readIssueSession.mockResolvedValue({
      ...session,
      needsThreadCapture: true
    });

    const issueSessions = useIssueSessions();
    await issueSessions.loadIssueSessions();

    issueSessions.patchIssueSession({
      codexThreadId: "019e1575-2458-7b93-bf9d-e7d7ffd49ad2",
      needsThreadCapture: false,
      sessionId: session.sessionId
    });

    expect(issueSessions.selectedSession.value.codexThreadId)
      .toBe("019e1575-2458-7b93-bf9d-e7d7ffd49ad2");
    expect(issueSessions.selectedSession.value.needsThreadCapture).toBe(false);
    expect(issueSessions.issueSessions.value[0].codexThreadId)
      .toBe("019e1575-2458-7b93-bf9d-e7d7ffd49ad2");
    expect(issueSessionFacts(issueSessions.selectedSession.value)
      .find((fact) => fact.key === "codex")?.value)
      .toBe("019e1575-2458-7b93-bf9d-e7d7ffd49ad2");
  });

  it("rewinds the selected session and refreshes the visible list", async () => {
    const session = {
      currentStep: "issue_drafted",
      sessionId: "2026-05-12_13-07-36",
      status: "running"
    };
    const rewoundSession = {
      ...session,
      currentStep: "dependencies_installed",
      completedSteps: ["session_created", "worktree_created"],
      currentStepAction: {
        input: { type: "none" },
        stepId: "dependencies_installed"
      }
    };
    listIssueSessions
      .mockResolvedValueOnce({ sessions: [session] })
      .mockResolvedValueOnce({ sessions: [rewoundSession] });
    readIssueSession.mockResolvedValue(session);
    rewindIssueSession.mockResolvedValue(rewoundSession);

    const issueSessions = useIssueSessions();
    await issueSessions.loadIssueSessions();
    const response = await issueSessions.rewindSelectedSession("dependencies_installed");

    expect(rewindIssueSession).toHaveBeenCalledWith(session.sessionId, "dependencies_installed");
    expect(response.currentStep).toBe("dependencies_installed");
    expect(issueSessions.selectedSession.value.currentStep).toBe("dependencies_installed");
    expect(issueSessions.issueSessions.value[0].currentStep).toBe("dependencies_installed");
    expect(issueSessions.issueSessionsError.value).toBe("");
  });

  it("surfaces structured rewind failures", async () => {
    const session = {
      currentStep: "plan_executed",
      sessionId: "2026-05-12_13-07-36",
      status: "running"
    };
    const failure = {
      ...session,
      ok: false,
      errors: [
        {
          code: "rewind_step_not_allowed",
          message: "Only Plan made can be used as a cycle rewind target."
        }
      ]
    };
    listIssueSessions.mockResolvedValue({ sessions: [session] });
    readIssueSession.mockResolvedValue(session);
    rewindIssueSession.mockResolvedValue(failure);

    const issueSessions = useIssueSessions();
    await issueSessions.loadIssueSessions();
    const response = await issueSessions.rewindSelectedSession("plan_executed");

    expect(response.ok).toBe(false);
    expect(issueSessions.issueSessionsError.value)
      .toBe("Only Plan made can be used as a cycle rewind target.");
  });
});
