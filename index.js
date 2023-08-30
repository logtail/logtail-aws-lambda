import { Logtail } from "@logtail/node"
import { parseRecords } from "./src/parser.js"

// Set up Better Stack logger
if (!process.env.BETTER_STACK_SOURCE_TOKEN) {
  throw new Error("Better Stack source token has not been set in ENV variable BETTER_STACK_SOURCE_TOKEN.")
}
const options = {}
if (process.env.BETTER_STACK_ENTRYPOINT) {
  options.endpoint = process.env.BETTER_STACK_ENTRYPOINT
}
const logger = new Logtail(process.env.BETTER_STACK_SOURCE_TOKEN, options)

// Main entrypoint for Lambda
export async function handler(event, context) {
  const records = await parseRecords(event, context)

  return await Promise.all(records.map(record => logger.log(record.message, record.level, record.data)))
}
