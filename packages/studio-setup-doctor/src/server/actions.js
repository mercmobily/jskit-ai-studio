import {
  studioSetupQueryInputValidator,
  repairInputValidator
} from "./inputSchemas.js";

const ACTION_READ_STUDIO_SETUP = "feature.studio-setup-doctor.read";
const ACTION_REPAIR_STUDIO_SETUP = "feature.studio-setup-doctor.repair";

const featureActions = Object.freeze([
  {
    id: ACTION_READ_STUDIO_SETUP,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: studioSetupQueryInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_STUDIO_SETUP
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.getStatus(input);
    }
  },
  {
    id: ACTION_REPAIR_STUDIO_SETUP,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: repairInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_REPAIR_STUDIO_SETUP
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.repair(input);
    }
  }
]);

export {
  ACTION_READ_STUDIO_SETUP,
  ACTION_REPAIR_STUDIO_SETUP,
  featureActions
};
