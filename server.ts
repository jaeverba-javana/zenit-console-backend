import { log } from "node:console";
import express from "express";
import { createServer } from "node:http";
import { BASE, IS_ON_LOCAL, IS_PRODUCTION } from "./utils/constants.ts";
import type { UserConfig, ViteDevServer } from "vite";
import { trace } from "@opentelemetry/api";
import { fileURLToPath } from "node:url";

log("isRunningOnProductionMode:", IS_PRODUCTION);
log("isRunningOnLocalMode:", IS_ON_LOCAL);

let templateHtml: string;

if (IS_PRODUCTION) {
  try {
    templateHtml = await Deno.readTextFile(new URL("./frontend/dist/client/index.html", import.meta.url));
    log("Successfully loaded template HTML from ./frontend/dist/client/index.html");
  } catch (error) {
    log("Error loading template HTML from ./dist/client/index.html:", error);
  }
}

const app = express();
const httpServer = createServer(app);

const vite: ViteDevServer | undefined = IS_PRODUCTION
  ? await (async function () {
    const compression = (await import("compression")).default;
    const sirv = (await import("sirv")).default;

		// @ts-ignore: It's ok
    app.use(compression());
    app.use(
      sirv(
        new URL("./frontend/dist/client", import.meta.url).pathname.slice(1),
        {
          dev: false,
          extensions: [],
        },
      ),
    );
    return undefined;
  })()
  : await (async function () {
    const { createServer } = await import("vite");
    const viteConfig = (await import("@package/frontend/viteconfig")).default;
    const v = await createServer({
      ...viteConfig,
      root: fileURLToPath(new URL("./frontend", import.meta.url)),
      appType: "custom",
      base: BASE,
      configFile: false,
      server: {
				middlewareMode: true,
				allowedHosts: true,
        hmr: {
          overlay: false,
          protocol: "ws",
          port: 5174,
					host: "localhost",
        },
      },
    } as UserConfig);
    app.use(v.middlewares);
    return v;
  })();

app.use("/", async (req, res) => {
  const tracer = trace.getTracer("default");

  try {
    const url = req.originalUrl.replace(BASE, "/");
    let template: string;

    if (IS_PRODUCTION) {
      template = templateHtml;
    } else {
      template = await Deno.readTextFile(new URL("./frontend/index.html", import.meta.url));
      template = await vite?.transformIndexHtml(url, template) ?? templateHtml;
    }

    if (!template || template.trim() === "") {
      throw new Error("Template HTML is empty.");
    }

    const html = template;

    tracer.startActiveSpan("html_response", (span) => {
      res.status(200).set({ "Content-Type": "text/html" }).send(html);
    });
  } catch (e) {
    log("Error during request handling:", e);

    if (e instanceof Error) {
      vite?.ssrFixStacktrace(e);
      log(e.stack);
      res.status(500).send(e.stack);
    } else {
      const errorMessage = String(e);
      log("Non-Error exception:", errorMessage);
      res.status(500).send(`Server error: ${errorMessage}`);
    }
  }
});

export default httpServer;
