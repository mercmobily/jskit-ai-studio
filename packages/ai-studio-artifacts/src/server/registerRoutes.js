import { artifactsInputValidator } from "./inputSchemas.js";
import {
  ACTION_READ_ARTIFACTS,
  ACTION_SAVE_ARTIFACTS
} from "./actions.js";
import { createAiStudioFeatureRoutes } from "../../../../server/lib/aiStudio/featureRoutes.js";

function registerRoutes(
  app,
  {
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createAiStudioFeatureRoutes(app, {
    localRequestMessage: "AI Studio artifact routes only accept loopback Studio requests.",
    routeRelativePath,
    routeSurface,
    tags: ["studio", "ai-studio-artifacts"]
  });

  routes.actionRoute("GET", "/sessions/:sessionId/artifacts", {
    actionId: ACTION_READ_ARTIFACTS,
    buildInput(request) {
      return {
        actionId: request.query?.actionId,
        sessionId: request.params.sessionId
      };
    },
    summary: "Read editable AI Studio artifacts."
  });

  routes.actionRoute("PUT", "/sessions/:sessionId/artifacts", {
    actionId: ACTION_SAVE_ARTIFACTS,
    body: artifactsInputValidator,
    buildInput(request) {
      return {
        ...routes.requestBody(request),
        sessionId: request.params.sessionId
      };
    },
    summary: "Save editable AI Studio artifacts."
  });
}

export { registerRoutes };
