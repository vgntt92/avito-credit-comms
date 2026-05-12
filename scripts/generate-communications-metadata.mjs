import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, "..")
const csvPath = path.join(projectRoot, "src", "data", "communications.csv")
const metadataPath = path.join(projectRoot, "src", "data", "communications-metadata.json")
const snapshotPath = path.join(projectRoot, "src", "data", "communications-snapshot.json")
const gitFilePath = "src/data/communications.csv"
const textFields = [
  "push_title",
  "push_subtitle",
  "email_subject",
  "email_snippet",
  "email_title",
  "email_body",
  "email_button"
]
const minimumSnapshotOverlap = 0.75

function runGit(args) {
  try {
    return execFileSync("git", args, {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim()
  } catch {
    return ""
  }
}

function parseCsv(source) {
  const firstLine = source.split(/\r?\n/, 1)[0] ?? ""
  const delimiter = firstLine.split(";").length > firstLine.split(",").length ? ";" : ","
  const rows = []
  let currentRow = []
  let currentValue = ""
  let insideQuotes = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const nextChar = source[index + 1]

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentValue += '"'
        index += 1
      } else {
        insideQuotes = !insideQuotes
      }
      continue
    }

    if (char === delimiter && !insideQuotes) {
      currentRow.push(currentValue)
      currentValue = ""
      continue
    }

    if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1
      }

      currentRow.push(currentValue)
      currentValue = ""

      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow)
      }

      currentRow = []
      continue
    }

    currentValue += char
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue)
    rows.push(currentRow)
  }

  const [headers = [], ...dataRows] = rows

  return dataRows.map((row) =>
    headers.reduce((record, header, index) => {
      record[header] = row[index] ?? ""
      return record
    }, {})
  )
}

function pickTextFields(record) {
  return textFields.reduce((accumulator, field) => {
    accumulator[field] = record[field] ?? ""
    return accumulator
  }, {})
}

function hasTextChanged(previousRecord, nextRecord) {
  if (!previousRecord || !nextRecord) {
    return true
  }

  return textFields.some((field) => (previousRecord[field] ?? "") !== (nextRecord[field] ?? ""))
}

function toRecordMap(records) {
  return new Map(records.map((record) => [String(record.id), pickTextFields(record)]))
}

function getFallbackDate() {
  try {
    return statSync(csvPath).mtime.toISOString()
  } catch {
    return new Date().toISOString()
  }
}

function readJson(filePath) {
  if (!existsSync(filePath)) {
    return {}
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8"))
  } catch {
    return {}
  }
}

function main() {
  const currentCsv = readFileSync(csvPath, "utf8")
  const currentRecords = parseCsv(currentCsv)
  const currentRecordMap = toRecordMap(currentRecords)
  const previousMetadata = readJson(metadataPath)
  const previousSnapshot = readJson(snapshotPath)
  const metadata = Object.fromEntries(currentRecords.map((record) => [String(record.id), { lastTextChangeAt: null }]))
  const historyOutput = runGit(["log", "--follow", "--reverse", "--format=%H|%cI", "--", gitFilePath])
  const historyEntries = historyOutput ? historyOutput.split("\n").filter(Boolean).map((line) => line.split("|")) : []

  let previousSnapshotMap = new Map()
  let headSnapshotMap = new Map()

  for (const [commitSha, commitDate] of historyEntries) {
    const snapshotSource = runGit(["show", `${commitSha}:${gitFilePath}`])

    if (!snapshotSource) {
      continue
    }

    const snapshotMap = toRecordMap(parseCsv(snapshotSource))

    for (const [id, record] of snapshotMap.entries()) {
      if (hasTextChanged(previousSnapshotMap.get(id), record)) {
        metadata[id] = { lastTextChangeAt: commitDate }
      }
    }

    previousSnapshotMap = snapshotMap
    headSnapshotMap = snapshotMap
  }

  const fallbackDate = getFallbackDate()
  const previousSnapshotIds = Object.keys(previousSnapshot)
  const currentIds = Array.from(currentRecordMap.keys())
  const overlappingIds = currentIds.filter((id) => Object.hasOwn(previousSnapshot, id)).length
  const hasReliablePreviousSnapshot =
    previousSnapshotIds.length > 0 &&
    currentIds.length > 0 &&
    overlappingIds / currentIds.length >= minimumSnapshotOverlap

  if (!historyEntries.length) {
    for (const id of currentRecordMap.keys()) {
      const previousRecord = hasReliablePreviousSnapshot ? previousSnapshot[id] : currentRecordMap.get(id)
      const currentRecord = currentRecordMap.get(id)
      const previousDate = previousMetadata[id]?.lastTextChangeAt ?? fallbackDate

      metadata[id] = {
        lastTextChangeAt: hasTextChanged(previousRecord, currentRecord) ? fallbackDate : previousDate
      }
    }
  } else {
    for (const [id, currentRecord] of currentRecordMap.entries()) {
      const headRecord = headSnapshotMap.get(id)

      if (!headRecord || hasTextChanged(headRecord, currentRecord)) {
        metadata[id] = { lastTextChangeAt: fallbackDate }
      } else if (!metadata[id]?.lastTextChangeAt) {
        metadata[id] = {
          lastTextChangeAt: previousMetadata[id]?.lastTextChangeAt ?? fallbackDate
        }
      }
    }
  }

  mkdirSync(path.dirname(metadataPath), { recursive: true })
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
  writeFileSync(snapshotPath, `${JSON.stringify(Object.fromEntries(currentRecordMap), null, 2)}\n`)
}

main()
