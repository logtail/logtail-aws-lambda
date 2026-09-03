import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import test from "node:test"
import { gunzipSync, gzipSync } from "node:zlib"
import { decode } from "@msgpack/msgpack"
import { parseRecords } from "../src/parser.js"

test("parseRecords adds Lambda context to unknown events", async () => {
  const event = { source: "unknown" }
  const context = {
    functionName: "forward-cloudwatch-logs",
    invokedFunctionArn: "arn:aws:lambda:eu-west-1:123456789012:function:forward-cloudwatch-logs",
  }

  assert.deepEqual(await parseRecords(event, context), [
    {
      message: "Unknown event passed to Better Stack AWS Lambda",
      level: "info",
      data: {
        event,
        context: {
          logger_lambda_name: context.functionName,
          logger_lambda_arn: context.invokedFunctionArn,
        },
      },
    },
  ])
})

test("handler sends gzip-compressed MessagePack logs", async t => {
  const requests = []
  const server = createServer((request, response) => {
    const chunks = []

    request.on("data", chunk => chunks.push(chunk))
    request.on("end", () => {
      requests.push({
        method: request.method,
        headers: request.headers,
        body: Buffer.concat(chunks),
      })
      response.writeHead(202)
      response.end()
    })
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const previousToken = process.env.BETTER_STACK_SOURCE_TOKEN
  const previousEntrypoint = process.env.BETTER_STACK_ENTRYPOINT
  const { port } = server.address()

  process.env.BETTER_STACK_SOURCE_TOKEN = "source-token"
  process.env.BETTER_STACK_ENTRYPOINT = `http://127.0.0.1:${port}`

  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.BETTER_STACK_SOURCE_TOKEN
    } else {
      process.env.BETTER_STACK_SOURCE_TOKEN = previousToken
    }

    if (previousEntrypoint === undefined) {
      delete process.env.BETTER_STACK_ENTRYPOINT
    } else {
      process.env.BETTER_STACK_ENTRYPOINT = previousEntrypoint
    }

    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  })

  const timestamp = Date.parse("2026-07-15T10:30:00.000Z")
  const requestId = "123e4567-e89b-12d3-a456-426614174000"
  const cloudWatchPayload = {
    messageType: "DATA_MESSAGE",
    owner: "123456789012",
    logGroup: "/aws/lambda/example",
    logStream: "2026/07/15/[$LATEST]abcdef",
    logEvents: [
      {
        id: "event-id",
        timestamp,
        message: `[ERROR] 2026-07-15T10:30:00.000Z RequestId: ${requestId} Forwarded message\n`,
      },
    ],
  }
  const event = {
    awslogs: {
      data: gzipSync(JSON.stringify(cloudWatchPayload)).toString("base64"),
    },
  }
  const context = {
    functionName: "forward-cloudwatch-logs",
    invokedFunctionArn: "arn:aws:lambda:eu-west-1:123456789012:function:forward-cloudwatch-logs",
  }

  const { handler } = await import("../index.js")
  const logs = await handler(event, context)

  assert.equal(logs.length, 1)
  assert.equal(requests.length, 1)

  const [request] = requests
  assert.equal(request.method, "POST")
  assert.equal(request.headers.authorization, "Bearer source-token")
  assert.equal(request.headers["content-type"], "application/msgpack")
  assert.equal(request.headers["content-encoding"], "gzip")
  assert.deepEqual(request.body.subarray(0, 2), Buffer.from([0x1f, 0x8b]))

  const [log] = decode(gunzipSync(request.body))
  assert.equal(log.message, "Forwarded message")
  assert.equal(log.level, "error")
  assert.equal(log.dt, "2026-07-15T10:30:00.000Z")
  assert.deepEqual(log.context, {
    owner: cloudWatchPayload.owner,
    log_id: "event-id",
    log_group: cloudWatchPayload.logGroup,
    log_stream: cloudWatchPayload.logStream,
    logger_lambda_name: context.functionName,
    logger_lambda_arn: context.invokedFunctionArn,
    request_id: requestId,
  })
})

test("handler rejects when ingesting fails, so AWS retries the invocation", async t => {
  let requestCount = 0
  const server = createServer((request, response) => {
    request.on("data", () => {})
    request.on("end", () => {
      requestCount++
      response.writeHead(500)
      response.end()
    })
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const previousToken = process.env.BETTER_STACK_SOURCE_TOKEN
  const previousEntrypoint = process.env.BETTER_STACK_ENTRYPOINT
  const { port } = server.address()

  process.env.BETTER_STACK_SOURCE_TOKEN = "source-token"
  process.env.BETTER_STACK_ENTRYPOINT = `http://127.0.0.1:${port}`

  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.BETTER_STACK_SOURCE_TOKEN
    } else {
      process.env.BETTER_STACK_SOURCE_TOKEN = previousToken
    }

    if (previousEntrypoint === undefined) {
      delete process.env.BETTER_STACK_ENTRYPOINT
    } else {
      process.env.BETTER_STACK_ENTRYPOINT = previousEntrypoint
    }

    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  })

  const event = { source: "unknown" }
  const context = {
    functionName: "forward-cloudwatch-logs",
    invokedFunctionArn: "arn:aws:lambda:eu-west-1:123456789012:function:forward-cloudwatch-logs",
  }

  // Query string busts the module cache so the logger is created with this test's entrypoint
  const { handler } = await import("../index.js?failing-ingest")
  await assert.rejects(handler(event, context))

  assert.ok(requestCount >= 1)
})
