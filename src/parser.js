export function parseRecords(event, context) {
  return [{
    message: "New event from AWS Lambda",
    level: "info",
    context: { event, context },
  }]
}
