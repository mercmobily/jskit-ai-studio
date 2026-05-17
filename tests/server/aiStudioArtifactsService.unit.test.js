import assert from "node:assert/strict";
import test from "node:test";

import {
  AiStudioSessionRuntime,
  FakeTargetAdapter
} from "../../server/lib/aiStudio/index.js";
import {
  createService
} from "../../packages/ai-studio-artifacts/src/server/service.js";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

function projectServiceForRuntime(runtime) {
  return {
    async createRuntime() {
      return runtime;
    }
  };
}

test("AI Studio artifacts service reads and saves editable issue artifacts", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          create_issue_on_gh: true
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_submitted",
      sessionId: "artifact_issue"
    });
    await runtime.store.writeArtifact("artifact_issue", "issue_title", "Original title\n");
    await runtime.store.writeArtifact("artifact_issue", "issue.md", "Original body\n");

    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const initial = await service.readArtifacts("artifact_issue");
    assert.equal(initial.ok, true);
    assert.equal(initial.artifactStates["issue.md"].editable, true);
    assert.equal(initial.artifactStates.issue_title.editable, true);
    assert.equal(initial.artifacts.issue_title, "Original title\n");

    const saved = await service.saveArtifacts("artifact_issue", {
      artifacts: {
        "issue.md": "Updated body",
        issue_title: "Updated title"
      }
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.artifacts["issue.md"], "Updated body\n");
    assert.equal(saved.artifacts.issue_title, "Updated title\n");
    assert.equal(await runtime.store.readMetadataValue("artifact_issue", "issue_title"), "Updated title");

    await runtime.store.writeMetadataValue("artifact_issue", "issue_url", "https://github.com/example/repo/issues/1");
    const blocked = await service.saveArtifacts("artifact_issue", {
      artifacts: {
        "issue.md": "Changed after submit"
      }
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.errors[0].code, "ai_studio_artifact_edit_not_available");
    assert.match(blocked.errors[0].message, /already exists/u);
  });
});

test("AI Studio artifacts service rejects unknown or empty artifact saves", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_submitted",
      sessionId: "artifact_invalid"
    });
    const service = createService({
      projectService: projectServiceForRuntime(runtime)
    });

    const empty = await service.saveArtifacts("artifact_invalid", {
      artifacts: {}
    });
    assert.equal(empty.ok, false);
    assert.equal(empty.errors[0].code, "ai_studio_artifacts_required");

    const unknown = await service.saveArtifacts("artifact_invalid", {
      artifacts: {
        "notes.txt": "No"
      }
    });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.errors[0].code, "ai_studio_artifact_not_editable");
  });
});
