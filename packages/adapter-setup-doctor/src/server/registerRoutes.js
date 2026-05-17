import { resolveScopedApiBasePath, normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";
import { sendDoctorEventStream } from "../../../../server/lib/doctorStream.js";
import {
  statusQueryInputValidator,
  terminalInputValidator,
  terminalStartInputValidator
} from "./inputSchemas.js";
import {
  ACTION_GET_STATUS
} from "./actions.js";
import {
  requireLocalStudioRequest
} from "../../../../server/lib/localStudioRequest.js";
import {
  requestBodyObject
} from "../../../../server/lib/aiStudio/serverResponses.js";

function getAdapterSetupDoctorService(app) {
  return app.make("feature.adapter-setup-doctor.service");
}

function requireLocalDoctorRequest(request, reply) {
  return requireLocalStudioRequest(request, reply, {
    message: "Adapter Setup Doctor routes only accept loopback Studio requests."
  });
}

function registerRoutes(
  app,
  {
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerRoutes requires application make().");
  }

  const router = app.make("jskit.http.router");
  const normalizedRouteSurface = normalizeSurfaceId(routeSurface);
  const routeBase = resolveScopedApiBasePath({
    routeBase: "/",
    relativePath: routeRelativePath,
    strictParams: false
  });

  router.register(
    "GET",
    routeBase,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "adapter-setup-doctor"],
        summary: "Read Adapter Setup Doctor status."
      },
      query: statusQueryInputValidator
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_GET_STATUS,
        input: request.input.query || {}
      });

      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/stream`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "adapter-setup-doctor"],
        summary: "Stream Adapter Setup Doctor status progress."
      }
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply)) {
        return;
      }
      await sendDoctorEventStream(reply, ({ emit }) => {
        return getAdapterSetupDoctorService(app).streamStatus({
          emit
        });
      });
    }
  );

  router.register(
    "POST",
    `${routeBase}/terminal`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "adapter-setup-doctor"],
        summary: "Start an Adapter Setup Doctor terminal session."
      },
      body: terminalStartInputValidator
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply)) {
        return;
      }
      const response = getAdapterSetupDoctorService(app).startTerminal(requestBodyObject(request));
      reply.code(response.ok === false ? 400 : 200).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/terminal/:sessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "adapter-setup-doctor"],
        summary: "Read an Adapter Setup Doctor terminal session."
      }
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply)) {
        return;
      }
      const response = getAdapterSetupDoctorService(app).readTerminal(request.params.sessionId);
      reply.code(response.ok === false ? 404 : 200).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/terminal/:sessionId/input`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "adapter-setup-doctor"],
        summary: "Write to an Adapter Setup Doctor terminal session."
      },
      body: terminalInputValidator
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply)) {
        return;
      }
      const response = getAdapterSetupDoctorService(app).writeTerminal(
        request.params.sessionId,
        requestBodyObject(request).data || ""
      );
      reply.code(response.ok === false ? 404 : 200).send(response);
    }
  );

  router.register(
    "DELETE",
    `${routeBase}/terminal/:sessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "adapter-setup-doctor"],
        summary: "Close an Adapter Setup Doctor terminal session."
      }
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply)) {
        return;
      }
      const response = await getAdapterSetupDoctorService(app).closeTerminal(request.params.sessionId);
      reply.code(200).send(response);
    }
  );
}

export { registerRoutes };
