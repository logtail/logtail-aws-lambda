import zlib from "zlib"

const EVENT_AWSLOGS = "awslogs"
const EVENT_UNKNOWN = "unknown"

export async function parseRecords(event, context) {
  const records = await parseBasicRecords(event)

  records.map(record => {
    record.message ||= "Unknown event passed to Better Stack AWS Lambda"
    record.level ||= "info"
    record.data ||= {}
    record.data.context ||= {}
    record.data.context.logger_lambda_name = context.functionName
    record.data.context.logger_lambda_arn = context.invokedFunctionArn
  })

  return records
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
          log_id: logEvent.id,
          owner: awsLogsData.owner,
          log_group: awsLogsData.logGroup,
          log_stream: awsLogsData.logStream,
        },
      }
    })
  }

  return [{ message: "Unknown AWS Logs message type", data: { event } }]
}
