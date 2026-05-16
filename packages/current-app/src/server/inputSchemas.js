import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const currentAppQueryInputValidator = deepFreeze({
  schema: createSchema({
    includeGit: {
      type: "boolean",
      required: false
    }
  }),
  mode: "patch"
});

const terminalInputValidator = deepFreeze({
  schema: createSchema({
    data: {
      type: "string",
      noTrim: true,
      required: true
    }
  }),
  mode: "patch"
});

const npmScriptTerminalInputValidator = deepFreeze({
  schema: createSchema({
    scriptName: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const starredNpmScriptsInputValidator = deepFreeze({
  schema: createSchema({
    scriptNames: {
      type: "array",
      items: {
        type: "string",
        noTrim: false
      },
      required: true
    }
  }),
  mode: "patch"
});

const codexThreadInputValidator = deepFreeze({
  schema: createSchema({
    threadId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const codexPromptHandoffInputValidator = deepFreeze({
  schema: createSchema({
    outputStart: {
      type: "string",
      noTrim: false,
      required: false
    },
    signature: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const codexAttachmentInputValidator = deepFreeze({
  schema: createSchema({
    contentType: {
      type: "string",
      noTrim: false,
      required: false
    },
    dataBase64: {
      type: "string",
      noTrim: true,
      required: true
    },
    fileName: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const rewindIssueSessionInputValidator = deepFreeze({
  schema: createSchema({
    stepId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const issueSessionDraftInputValidator = deepFreeze({
  schema: createSchema({
    issueText: {
      type: "string",
      noTrim: true,
      required: true
    },
    issueTitle: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const issueSessionBlueprintInputValidator = deepFreeze({
  schema: createSchema({
    blueprintText: {
      type: "string",
      noTrim: true,
      required: true
    }
  }),
  mode: "patch"
});

const issueSessionPullRequestDraftInputValidator = deepFreeze({
  schema: createSchema({
    pullRequestText: {
      type: "string",
      noTrim: true,
      required: true
    }
  }),
  mode: "patch"
});

export {
  codexAttachmentInputValidator,
  codexPromptHandoffInputValidator,
  codexThreadInputValidator,
  currentAppQueryInputValidator,
  issueSessionBlueprintInputValidator,
  issueSessionDraftInputValidator,
  issueSessionPullRequestDraftInputValidator,
  npmScriptTerminalInputValidator,
  rewindIssueSessionInputValidator,
  starredNpmScriptsInputValidator,
  terminalInputValidator
};
