import zlib from "zlib"

const EVENT_AWSLOGS = "awslogs"
const EVENT_UNKNOWN = "unknown"

export async function parseRecords(event, context) {
  const records = await parseBasicRecords(event)

  return records.map(record => parseRecord(record, context))
}

function parseRecord(record, context) {
  // Fill in defaults
  record.message ||= "Unknown event passed to Better Stack AWS Lambda"
  record.level ||= "info"
  record.data ||= {}
  record.data.context ||= {}
  record.data.context.logger_lambda_name = context.functionName
  record.data.context.logger_lambda_arn = context.invokedFunctionArn

  // Extract level in brackets from start
  const bracketLevelMatch = record.message.match(/^\[(DEBUG|TRACE|VERBOSE|INFO|WARN(ING)?|ERROR|CRITICAL|FATAL)]\s+/)
  if (bracketLevelMatch) {
    record.message = record.message.replace(bracketLevelMatch[0], "")
    record.data.level = bracketLevelMatch[1].toLowerCase()
  }

  // Extract datetime in ISO-8601 from start (eg. 2023-08-30T10:43:46.122Z)
  const datetimeMatch = record.message.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(([+-]\d\d:\d\d)|Z)?)\s+/)
  if (datetimeMatch) {
    record.message = record.message.replace(datetimeMatch[0], "")
    record.data.dt = new Date(datetimeMatch[1])
  }

  // Extract UUID from start or as RequestId: UUID
  const requestUuidMatch = record.message.match(/(?:^|RequestId: )([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})\s+/)
  if (requestUuidMatch) {
    record.message = record.message.replace(requestUuidMatch[0], "")
    record.data.context.request_id = requestUuidMatch[1]
  } else {
    // The request UUID may be undefined when loading lambda function, matching more strictly with a tab and removing it
    record.message = record.message.replace(/^undefined\t\s*/, "")
  }

  // Extract level from start
  const levelMatch = record.message.match(/^(DEBUG|TRACE|VERBOSE|INFO|WARN(ING)?|ERROR|CRITICAL|FATAL)\s+/)
  if (levelMatch) {
    record.message = record.message.replace(levelMatch[0], "")
    record.data.level = levelMatch[1].toLowerCase()
  }

  // Remove line separators from the end
  record.message = record.message.replace(/[\n\r]+$/, "")

  return record
}

async function parseBasicRecords(event) {
  switch (parseType(event)) {
    case EVENT_AWSLOGS:
      return await parseAwsLogsRecords(event)
    default:
      return [{ data: { event } }]
  }
}

function parseType(event) {
  if (typeof event.awslogs?.data === "string") {
    return EVENT_AWSLOGS
  }

  return EVENT_UNKNOWN
}

async function parseAwsLogsRecords(event) {
  const awsLogsData = await new Promise((resolve, reject) => {
    zlib.gunzip(Buffer.from(event.awslogs.data, "base64"), function (error, buffer) {
      if (error) {
        reject(new Error("Uncompressing event payload failed."))
      }
      resolve(JSON.parse(buffer.toString("utf8")))
    })
  });

  if (awsLogsData.messageType === "DATA_MESSAGE") {
    return awsLogsData.logEvents.map(logEvent => {
      return {
        message: logEvent.message,
        data: {
          dt: new Date(logEvent.timestamp),
          context: {
            owner: awsLogsData.owner,
            log_id: logEvent.id,
            log_group: awsLogsData.logGroup,
            log_stream: awsLogsData.logStream,
          },
        },
      }
    })
  }

  return [{ message: "Unknown AWS Logs message type", data: { event } }]
}
