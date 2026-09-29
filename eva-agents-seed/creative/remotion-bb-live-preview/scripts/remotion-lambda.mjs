import {
  chmodSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ENTRY_POINT = path.join(PROJECT_ROOT, "src", "index.ts");
const CONFIG_PATH = path.join(PROJECT_ROOT, "remotion-lambda.local.json");

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      result.help = true;
    } else if (token.startsWith("--")) {
      const name = token.slice(2);
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        result[name] = next;
        index += 1;
      } else {
        result[name] = true;
      }
    } else {
      result._.push(token);
    }
  }
  return result;
}

function readConfig() {
  if (!existsSync(CONFIG_PATH)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    throw new Error("Invalid local Lambda config: " + CONFIG_PATH);
  }
}

function writeConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(CONFIG_PATH, 0o600);
}

function requireValue(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Missing " + label + ".");
  }
  return value.trim();
}

function positiveInteger(value, fallback, label) {
  if (value === undefined) {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(label + " must be a positive integer.");
  }
  return number;
}

function accountIds(config) {
  const primary = requireValue(
    process.env.REMOTION_AWS_PRIMARY_ACCOUNT ?? config.primaryAccount ?? "1",
    "REMOTION_AWS_PRIMARY_ACCOUNT",
  );
  const fallback = requireValue(
    process.env.REMOTION_AWS_FALLBACK_ACCOUNT ?? config.fallbackAccount ?? "2",
    "REMOTION_AWS_FALLBACK_ACCOUNT",
  );
  if (!["1", "2"].includes(primary) || !["1", "2"].includes(fallback)) {
    throw new Error("Primary and fallback accounts must be 1 or 2.");
  }
  if (primary === fallback) {
    throw new Error("Primary and fallback accounts must be different.");
  }
  return { primary, fallback };
}

function selectAccount(config, account) {
  const selected = requireValue(account, "an AWS account");
  if (selected !== "1" && selected !== "2") {
    throw new Error("AWS account must be 1 or 2.");
  }

  const accountConfig = config.accounts?.[selected] ?? {};
  const region = requireValue(
    process.env["REMOTION_AWS_REGION_" + selected] ??
      process.env.REMOTION_AWS_REGION ??
      accountConfig.region ??
      "us-east-1",
    "REMOTION_AWS_REGION",
  );
  const accessKeyId = requireValue(
    process.env["REMOTION_AWS_ACCESS_KEY_ID_" + selected],
    "REMOTION_AWS_ACCESS_KEY_ID_" + selected,
  );
  const secretAccessKey = requireValue(
    process.env["REMOTION_AWS_SECRET_ACCESS_KEY_" + selected],
    "REMOTION_AWS_SECRET_ACCESS_KEY_" + selected,
  );

  // These exist only in this child process. Remotion reads REMOTION_* and
  // the AWS SDK also recognizes the standard names.
  process.env.REMOTION_AWS_ACCESS_KEY_ID = accessKeyId;
  process.env.REMOTION_AWS_SECRET_ACCESS_KEY = secretAccessKey;
  process.env.AWS_ACCESS_KEY_ID = accessKeyId;
  process.env.AWS_SECRET_ACCESS_KEY = secretAccessKey;
  process.env.REMOTION_AWS_REGION = region;
  process.env.AWS_REGION = region;

  return { account: selected, region, accountConfig };
}

function getR2(args, config) {
  const configR2 = config.r2 ?? {};
  const bucket = requireValue(
    args["r2-bucket"] ?? process.env.CLOUDFLARE_R2_BUCKET ?? configR2.bucket,
    "CLOUDFLARE_R2_BUCKET",
  );
  const publicUrl = requireValue(
    args["public-url"] ??
      process.env.CLOUDFLARE_R2_PUBLIC_URL ??
      configR2.publicUrl,
    "CLOUDFLARE_R2_PUBLIC_URL",
  ).replace(/\/+$/, "");
  const endpoint = requireValue(
    process.env.CLOUDFLARE_R2_ENDPOINT,
    "CLOUDFLARE_R2_ENDPOINT",
  );
  const accessKeyId = requireValue(
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    "CLOUDFLARE_R2_ACCESS_KEY_ID",
  );
  const secretAccessKey = requireValue(
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
  );

  return {
    bucket,
    publicUrl,
    provider: {
      endpoint,
      accessKeyId,
      secretAccessKey,
      region: "auto",
      forcePathStyle: true,
    },
  };
}

function outputKey(value, composition) {
  const key = (value ?? "renders/" + composition + "/" + Date.now() + ".mp4")
    .trim()
    .replace(/^\/+/, "");
  if (!key || key.split("/").includes("..")) {
    throw new Error(
      "The output key must be a non-empty relative R2 object key.",
    );
  }
  return key;
}

function toPublicUrl(base, key) {
  return new URL(key, base + "/").toString();
}

function parseProps(value) {
  if (value === undefined) {
    return undefined;
  }
  try {
    const props = JSON.parse(value);
    if (!props || typeof props !== "object" || Array.isArray(props)) {
      throw new Error("must be a JSON object");
    }
    return props;
  } catch (error) {
    throw new Error(
      "--props must be a JSON object: " +
        (error instanceof Error ? error.message : "invalid JSON"),
    );
  }
}

function printHelp() {
  console.log(
    [
      "Remotion Lambda + Cloudflare R2",
      "",
      "Commands:",
      "  setup   Deploy matching primary and fallback Lambda/site infrastructure",
      "  render  Render on primary; use fallback only before a render starts",
      "  status  Show functions in both configured AWS accounts",
      "",
      "Examples:",
      "  npm run lambda:setup",
      "  npm run lambda:render -- --composition SocialLaunch",
      "  npm run lambda:status",
      "",
      "Setup options: --target primary|fallback|both (default: both)",
      "Render options: --composition, --key, --props, --concurrency, --frames-per-lambda",
      "Diagnostics may use --account 1 or --account 2 with status only.",
    ].join("\n"),
  );
}

function safeError(error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const name of [
    "REMOTION_AWS_ACCESS_KEY_ID_1",
    "REMOTION_AWS_SECRET_ACCESS_KEY_1",
    "REMOTION_AWS_ACCESS_KEY_ID_2",
    "REMOTION_AWS_SECRET_ACCESS_KEY_2",
    "CLOUDFLARE_R2_ACCESS_KEY_ID",
    "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
  ]) {
    const secret = process.env[name];
    if (secret) {
      message = message.split(secret).join("[redacted]");
    }
  }
  return message;
}

function isFallbackEligible(error) {
  if (error?.renderStarted) {
    return false;
  }
  if (error?.renderStarted === false) {
    return true;
  }
  const name = String(error?.name ?? "");
  const status = Number(error?.$metadata?.httpStatusCode ?? 0);
  const message = safeError(error).toLowerCase();
  if (status >= 500) {
    return true;
  }
  if (
    [
      "accessdenied",
      "accessdeniedexception",
      "credentialsprovidererror",
      "networkingerror",
      "resource_not_found_exception",
      "resourcenotfoundexception",
      "serviceunavailableexception",
      "timeout",
      "timeoutError",
      "throttlingexception",
      "toomanyrequestsexception",
    ].some((value) => name.toLowerCase().includes(value.toLowerCase()))
  ) {
    return true;
  }
  return (
    message.includes("no compatible lambda") ||
    message.includes("no deployed remotion site") ||
    message.includes("could not connect") ||
    message.includes("credentials")
  );
}

async function makeBundle() {
  const { bundle } = await import("@remotion/bundler");
  console.log("Bundling the current Remotion catalog...");
  return bundle({
    entryPoint: ENTRY_POINT,
    rootDir: PROJECT_ROOT,
    onProgress: (value) => {
      const percent = Math.round(value <= 1 ? value * 100 : value);
      process.stdout.write("\rBundle progress: " + percent + "%");
      if (percent === 100) {
        process.stdout.write("\n");
      }
    },
  });
}

function cleanupBundle(bundleDir) {
  if (
    typeof bundleDir === "string" &&
    bundleDir.startsWith(os.tmpdir() + path.sep)
  ) {
    rmSync(bundleDir, { recursive: true, force: true });
  }
}

async function findCompatibleFunction(region) {
  const { getFunctions } = await import("@remotion/lambda-client");
  const functions = await getFunctions({
    region,
    compatibleOnly: true,
    logLevel: "info",
  });
  return functions[0]?.functionName ?? null;
}

async function setupOne(args, config, account, r2) {
  const accountInfo = selectAccount(config, account);
  const { deployFunction, deploySiteFromBundle } =
    await import("@remotion/lambda");
  const siteBucket = requireValue(
    args["site-bucket"] ??
      process.env["REMOTION_AWS_SITE_BUCKET_" + account] ??
      accountInfo.accountConfig.siteBucket,
    "REMOTION_AWS_SITE_BUCKET_" + account,
  );
  const siteName = (
    args["site-name"] ??
    config.siteName ??
    "bb-remotion-live-preview-" + account
  ).trim();

  console.log(
    "Deploying the matching Remotion Lambda for " +
      account +
      " in " +
      accountInfo.region +
      "...",
  );
  const deployed = await deployFunction({
    region: accountInfo.region,
    timeoutInSeconds: positiveInteger(args.timeout, 240, "--timeout"),
    memorySizeInMb: positiveInteger(args.memory, 2048, "--memory"),
    diskSizeInMb: positiveInteger(args.disk, 2048, "--disk"),
    createCloudWatchLogGroup: true,
    enableLambdaInsights: false,
    indent: true,
  });

  let bundleDir;
  try {
    bundleDir = await makeBundle();
    console.log("Uploading the site bundle to " + siteBucket + "...");
    const site = await deploySiteFromBundle({
      bucketName: siteBucket,
      region: accountInfo.region,
      bundleDir,
      siteName,
      privacy: "public",
    });
    const nextConfig = {
      ...config,
      siteName,
      primaryAccount:
        config.primaryAccount ??
        process.env.REMOTION_AWS_PRIMARY_ACCOUNT ??
        "1",
      fallbackAccount:
        config.fallbackAccount ??
        process.env.REMOTION_AWS_FALLBACK_ACCOUNT ??
        "2",
      r2: { ...config.r2, bucket: r2.bucket, publicUrl: r2.publicUrl },
      accounts: {
        ...config.accounts,
        [account]: {
          ...accountInfo.accountConfig,
          region: accountInfo.region,
          siteBucket,
          functionName: deployed.functionName,
          serveUrl: site.serveUrl,
        },
      },
    };
    console.log(
      JSON.stringify(
        {
          account,
          region: accountInfo.region,
          functionName: deployed.functionName,
          serveUrl: site.serveUrl,
          siteBucket,
          r2Bucket: r2.bucket,
          config: CONFIG_PATH,
        },
        null,
        2,
      ),
    );
    return nextConfig;
  } finally {
    cleanupBundle(bundleDir);
  }
}

async function setup(args, config, r2) {
  const ids = accountIds(config);
  const target = args.target ?? (args.account ? "account" : "both");
  let targets;
  if (target === "both") {
    targets = [ids.primary, ids.fallback];
  } else if (target === "primary") {
    targets = [ids.primary];
  } else if (target === "fallback") {
    targets = [ids.fallback];
  } else if (
    target === "account" &&
    (args.account === "1" || args.account === "2")
  ) {
    targets = [args.account];
  } else {
    throw new Error("--target must be primary, fallback, or both.");
  }

  let nextConfig = config;
  for (const account of targets) {
    nextConfig = await setupOne(args, nextConfig, account, r2);
    writeConfig(nextConfig);
  }
}

async function renderOnAccount(args, config, account, r2, primaryAccount) {
  let renderHasActivity = false;
  try {
    const accountInfo = selectAccount(config, account);
    const accountConfig = accountInfo.accountConfig;
    const functionName =
      (account === primaryAccount ? args.function : undefined) ??
      process.env["REMOTION_AWS_FUNCTION_NAME_" + account] ??
      accountConfig.functionName ??
      (await findCompatibleFunction(accountInfo.region));
    const selectedFunction = requireValue(
      functionName,
      "No compatible Lambda for account " +
        account +
        "; run lambda:setup first.",
    );
    const serveUrl = requireValue(
      (account === primaryAccount ? args["serve-url"] : undefined) ??
        process.env["REMOTION_SERVE_URL_" + account] ??
        accountConfig.serveUrl,
      "No deployed Remotion site for account " +
        account +
        "; run lambda:setup first.",
    );
    const composition = requireValue(
      args.composition ?? "BBLivePreview",
      "--composition",
    );
    const { renderMediaOnLambda, getRenderProgress } =
      await import("@remotion/lambda-client");
    const key = outputKey(args.key, composition);
    const started = await renderMediaOnLambda({
      region: accountInfo.region,
      functionName: selectedFunction,
      serveUrl,
      composition,
      inputProps: parseProps(args.props),
      codec: args.codec ?? "h264",
      concurrency:
        args.concurrency === undefined
          ? undefined
          : positiveInteger(args.concurrency, 1, "--concurrency"),
      framesPerLambda:
        args["frames-per-lambda"] === undefined
          ? undefined
          : positiveInteger(
              args["frames-per-lambda"],
              20,
              "--frames-per-lambda",
            ),
      privacy: "no-acl",
      overwrite: true,
      forceBucketName: accountConfig.renderBucket ?? accountConfig.siteBucket,
      forcePathStyle: true,
      outName: {
        bucketName: r2.bucket,
        key,
        s3OutputProvider: r2.provider,
      },
    });

    let lastPercent = -1;
    while (true) {
      await sleep(2000);
      const progress = await getRenderProgress({
        region: accountInfo.region,
        functionName: selectedFunction,
        bucketName: started.bucketName,
        renderId: started.renderId,
        s3OutputProvider: r2.provider,
        forcePathStyle: true,
      });
      const percent = Math.round((progress.overallProgress ?? 0) * 100);
      renderHasActivity =
        renderHasActivity ||
        (progress.lambdasInvoked ?? 0) > 0 ||
        (progress.framesRendered ?? 0) > 0 ||
        (progress.combinedFrames ?? 0) > 0 ||
        (progress.encodingStatus?.framesEncoded ?? 0) > 0;
      if (percent !== lastPercent) {
        console.log("Render progress: " + percent + "%");
        lastPercent = percent;
      }
      const errors = progress.errors ?? [];
      if (
        progress.fatalErrorEncountered ||
        (progress.done && errors.length > 0)
      ) {
        const details = errors
          .map((item) => item.message)
          .filter(Boolean)
          .join("; ");
        const failure = new Error(
          "Lambda render failed" + (details ? ": " + details : "."),
        );
        failure.renderStarted = renderHasActivity;
        throw failure;
      }
      if (!progress.done) {
        continue;
      }
      const finalKey = progress.outKey ?? key;
      console.log(
        JSON.stringify(
          {
            account,
            role: account === primaryAccount ? "primary" : "fallback",
            region: accountInfo.region,
            composition,
            renderId: started.renderId,
            r2Bucket: r2.bucket,
            r2Key: finalKey,
            publicUrl: toPublicUrl(r2.publicUrl, finalKey),
          },
          null,
          2,
        ),
      );
      return;
    }
  } catch (error) {
    if (error && typeof error === "object" && !("renderStarted" in error)) {
      error.renderStarted = renderHasActivity;
    }
    throw error;
  }
}

async function render(args, config, r2) {
  const ids = accountIds(config);
  try {
    return await renderOnAccount(args, config, ids.primary, r2, ids.primary);
  } catch (error) {
    if (!isFallbackEligible(error)) {
      throw error;
    }
    console.error(
      "Primary account " +
        ids.primary +
        " failed before render start; trying fallback account " +
        ids.fallback +
        ".",
    );
    return renderOnAccount(args, config, ids.fallback, r2, ids.primary);
  }
}

async function status(args, config) {
  const ids = accountIds(config);
  const targets = args.account ? [args.account] : [ids.primary, ids.fallback];
  const output = [];
  const { getFunctions } = await import("@remotion/lambda-client");
  for (const account of targets) {
    const accountInfo = selectAccount(config, account);
    const functions = await getFunctions({
      region: accountInfo.region,
      compatibleOnly: false,
      logLevel: "info",
    });
    output.push({
      account,
      role: account === ids.primary ? "primary" : "fallback",
      region: accountInfo.region,
      functions: functions.map(
        ({ functionName, version, memorySizeInMb, timeoutInSeconds }) => ({
          functionName,
          version,
          memorySizeInMb,
          timeoutInSeconds,
        }),
      ),
    });
  }
  console.log(JSON.stringify(output, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const command = args._[0] ?? "render";
  const config = readConfig();
  if (command === "status") {
    await status(args, config);
    return;
  }
  const r2 = getR2(args, config);
  if (command === "setup") {
    await setup(args, config, r2);
  } else if (command === "render") {
    await render(args, config, r2);
  } else {
    throw new Error(
      "Unknown command: " + command + ". Use setup, render, or status.",
    );
  }
}

main().catch((error) => {
  console.error("Remotion Lambda: " + safeError(error));
  process.exitCode = 1;
});
