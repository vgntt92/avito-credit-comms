import { useEffect, useRef, useState } from "react"
import { ArrowRight, Bell, CalendarDays, Check, CheckCheck, ChevronDown, Clock3, Copy, Mail, Package, Search, X } from "lucide-react"

import avitoPushIcon from "@/assets/avito-push-icon.png"
import csvRaw from "@/data/communications.csv?raw"
import metadataById from "@/data/communications-metadata.json"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const SEGMENTS = ["C2C", "B2C"]
const DATE_SORT_OPTIONS = [
  { value: "none", label: "Без сортировки" },
  { value: "desc", label: "Сначала обновлённые" },
  { value: "asc", label: "Сначала более старые" }
]
const MONTH_NAMES = "января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря"
const SPACE_PATTERN = "[ \\u00A0]"
const VARIABLE_TONE = "text-red-600"
const STATUS_NOTE_PATTERN = /\s*\(([^()]+)\)\s*$/

function mergeRanges(ranges) {
  if (!ranges.length) {
    return []
  }

  const sortedRanges = [...ranges].sort((left, right) => left.start - right.start)
  const mergedRanges = [sortedRanges[0]]

  for (let index = 1; index < sortedRanges.length; index += 1) {
    const range = sortedRanges[index]
    const lastRange = mergedRanges[mergedRanges.length - 1]

    if (range.start <= lastRange.end) {
      lastRange.end = Math.max(lastRange.end, range.end)
      continue
    }

    mergedRanges.push(range)
  }

  return mergedRanges
}

function findVariableRanges(text) {
  if (!text) {
    return []
  }

  const ranges = []
  const dateRangePattern = new RegExp(`\\d{1,2}${SPACE_PATTERN}(?:${MONTH_NAMES})${SPACE_PATTERN}до${SPACE_PATTERN}?\\d{1,2}${SPACE_PATTERN}(?:${MONTH_NAMES})`, "gi")
  const singleDatePattern = new RegExp(`\\d{1,2}${SPACE_PATTERN}(?:${MONTH_NAMES})`, "gi")
  const deliveryServicePattern = /(?:Почты России|Boxberry|Авито[ \u00A0][×x][ \u00A0]Exmail|Exmail|cdek\.ru|CDEK|СДЭК)/gi
  const pickupTypePattern = /отделение[ \u00A0]«Почты России»|пункт[ \u00A0]Boxberry|пункт[ \u00A0]Авито[ \u00A0][×x][ \u00A0]Exmail|постамат(?:ы)?/gi
  const streetAddressPattern = /(?:[А-ЯЁ][а-яё-]+,\s*)?(?:улица|ул\.|проспект|пр-т|переулок|пер\.|шоссе|наб\.|набережная|бульвар|бул\.|площадь|пл\.)[^\n.]+/gi

  for (const pattern of [dateRangePattern, singleDatePattern, deliveryServicePattern, pickupTypePattern, streetAddressPattern]) {
    for (const match of text.matchAll(pattern)) {
      if (typeof match.index === "number") {
        ranges.push({
          start: match.index,
          end: match.index + match[0].length
        })
      }
    }
  }

  return mergeRanges(ranges)
}

function renderHighlightedText(text, variableClassName = VARIABLE_TONE) {
  if (!text) {
    return text
  }

  const ranges = findVariableRanges(text)

  if (!ranges.length) {
    return text
  }

  const fragments = []
  let cursor = 0

  ranges.forEach((range, index) => {
    if (cursor < range.start) {
      fragments.push(text.slice(cursor, range.start))
    }

    fragments.push(
      <span className={cn("font-medium", variableClassName)} key={`${range.start}-${range.end}-${index}`}>
        {text.slice(range.start, range.end)}
      </span>
    )

    cursor = range.end
  })

  if (cursor < text.length) {
    fragments.push(text.slice(cursor))
  }

  return fragments
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

  const [headers, ...dataRows] = rows

  return dataRows.map((row) =>
    headers.reduce((record, header, index) => {
      record[header] = row[index] ?? ""
      return record
    }, {})
  )
}

function normalizeText(value) {
  return (value ?? "")
    .replace(/\\n/g, "\n")
    .replace(/\*/g, "\u00a0")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim()
}

function splitStatusLabel(value) {
  const normalizedValue = normalizeText(value)
  const match = normalizedValue.match(STATUS_NOTE_PATTERN)

  if (!match) {
    return {
      statusLabel: normalizedValue,
      statusNote: ""
    }
  }

  return {
    statusLabel: normalizedValue.replace(STATUS_NOTE_PATTERN, "").trim(),
    statusNote: match[1].trim()
  }
}

function buildCommunications(source) {
  return parseCsv(source).map((record) => ({
    ...splitStatusLabel(record.logistic_status),
    id: record.id,
    segment: record.segment,
    deliveryType: record.delivery_type,
    pushTitle: normalizeText(record.push_title),
    pushSubtitle: normalizeText(record.push_subtitle),
    emailSubject: normalizeText(record.email_subject),
    emailSnippet: normalizeText(record.email_snippet),
    emailTitle: normalizeText(record.email_title),
    emailBody: normalizeText(record.email_body),
    emailButton: normalizeText(record.email_button),
    lastTextChangeAt: metadataById[String(record.id)]?.lastTextChangeAt ?? null
  }))
}

const communications = buildCommunications(csvRaw)

function formatLastUpdated(value) {
  if (!value) {
    return null
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date)
}

function toDateInputValue(value) {
  if (!value) {
    return ""
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ""
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")

  return `${year}-${month}-${day}`
}

function matchesUpdatedSince(lastTextChangeAt, updatedSince) {
  if (!updatedSince) {
    return true
  }

  if (!lastTextChangeAt) {
    return false
  }

  const itemDate = new Date(lastTextChangeAt)

  if (Number.isNaN(itemDate.getTime())) {
    return false
  }

  const sinceDate = new Date(`${updatedSince}T00:00:00`)

  if (Number.isNaN(sinceDate.getTime())) {
    return true
  }

  return itemDate >= sinceDate
}

function formatDateFieldValue(value) {
  if (!value) {
    return "дд.мм.гггг"
  }

  const [year, month, day] = value.split("-")

  if (!year || !month || !day) {
    return value
  }

  return `${day}.${month}.${year}`
}

function sortCommunicationsByDate(items, sortMode) {
  if (sortMode === "none") {
    return items
  }

  const direction = sortMode === "desc" ? -1 : 1

  return [...items].sort((left, right) => {
    const leftTime = left.lastTextChangeAt ? new Date(left.lastTextChangeAt).getTime() : -Infinity
    const rightTime = right.lastTextChangeAt ? new Date(right.lastTextChangeAt).getTime() : -Infinity

    if (leftTime === rightTime) {
      return Number(left.id) - Number(right.id)
    }

    return (leftTime - rightTime) * direction
  })
}

function DateFilterField({ value, max, onChange, onClear }) {
  const inputRef = useRef(null)

  const openPicker = () => {
    if (!inputRef.current) {
      return
    }

    if (typeof inputRef.current.showPicker === "function") {
      inputRef.current.showPicker()
      return
    }

    inputRef.current.focus()
    inputRef.current.click()
  }

  return (
    <div className="relative mt-3 flex h-10 w-full min-w-0 items-center rounded-full border border-slate-200 bg-white pl-4 pr-2">
      <input
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        max={max}
        onChange={(event) => onChange(event.target.value)}
        ref={inputRef}
        tabIndex={-1}
        type="date"
        value={value}
      />
      <button
        className={cn(
          "inline-flex min-w-0 items-center gap-2 text-sm outline-none transition focus-visible:text-slate-900",
          value ? "text-slate-700" : "text-slate-400"
        )}
        onClick={openPicker}
        type="button"
      >
        <span>{formatDateFieldValue(value)}</span>
        <CalendarDays className="size-4 text-slate-400" />
      </button>
      <button
        aria-label="Сбросить дату"
        className={cn(
          "ml-auto inline-flex size-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700",
          value ? "opacity-100" : "opacity-35"
        )}
        onClick={onClear}
        title="Сбросить дату"
        type="button"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

function getDeliveryTypes(segment) {
  const uniqueValues = new Set()
  const orderedValues = []

  communications.forEach((item) => {
    if (item.segment === segment && !uniqueValues.has(item.deliveryType)) {
      uniqueValues.add(item.deliveryType)
      orderedValues.push(item.deliveryType)
    }
  })

  return orderedValues
}

function getStatuses(segment, deliveryType) {
  const uniqueValues = new Set()
  const orderedValues = []

  communications.forEach((item) => {
    if (item.segment === segment && item.deliveryType === deliveryType && !uniqueValues.has(item.statusLabel)) {
      uniqueValues.add(item.statusLabel)
      orderedValues.push(item.statusLabel)
    }
  })

  return orderedValues
}

function normalizeSearchValue(value) {
  return value.trim().toLocaleLowerCase("ru-RU")
}

function statusMatchesSearch(status, query) {
  const normalizedQuery = normalizeSearchValue(query)

  if (!normalizedQuery) {
    return true
  }

  return status.toLocaleLowerCase("ru-RU").includes(normalizedQuery)
}

function getFieldCount(items) {
  return items.reduce((count, item) => {
    return (
      count +
      [item.pushTitle, item.pushSubtitle, item.emailSubject, item.emailSnippet, item.emailTitle, item.emailBody, item.emailButton].filter(Boolean)
        .length
    )
  }, 0)
}

function CopyFieldButton({ label, value, copyValue, copiedKey, onCopy }) {
  if (!value) {
    return null
  }

  const key = `${label}:${copyValue}`
  const isCopied = copiedKey === key

  return (
    <Button
      aria-label={label}
      className="h-7 w-7 rounded-md border-transparent bg-transparent p-0 text-slate-400 shadow-none hover:border-transparent hover:bg-slate-100 hover:text-slate-900"
      size="icon"
      title={label}
      variant="outline"
      onClick={() => onCopy(key, copyValue)}
    >
      {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  )
}

function CopyableText({ label, value, copiedKey, onCopy, className, multiline = false, as: Component = "p" }) {
  if (!value) {
    return null
  }

  return (
    <div className="group flex items-start gap-2">
      <Component className={cn("min-w-0 flex-1", multiline && "whitespace-pre-line", className)}>
        {renderHighlightedText(value)}
      </Component>
      <div className="shrink-0 pt-0.5 opacity-100 transition-opacity">
        <CopyFieldButton copiedKey={copiedKey} copyValue={value} label={label} onCopy={onCopy} value={value} />
      </div>
    </div>
  )
}

function CopyableTextPair({ children, copiedKey, label, onCopy, value }) {
  if (!value) {
    return null
  }

  return (
    <div className="group flex items-center gap-2">
      <div className="min-w-0 flex-1">{children}</div>
      <div className="shrink-0 opacity-100 transition-opacity">
        <CopyFieldButton copiedKey={copiedKey} copyValue={value} label={label} onCopy={onCopy} value={value} />
      </div>
    </div>
  )
}

function EmailBodyBlock({ value, copiedKey, onCopy }) {
  if (!value) {
    return null
  }

  const paragraphs = value.split(/\n{2,}/).filter(Boolean)

  return (
    <div className="group flex items-start gap-2">
      <div className="min-w-0 flex-1 space-y-1">
        {paragraphs.map((paragraph, index) => (
          <p className="text-sm leading-6 text-slate-700" key={`${index}-${paragraph.slice(0, 24)}`}>
            {renderHighlightedText(paragraph)}
          </p>
        ))}
      </div>
      <div className="shrink-0 pt-0.5 opacity-100 transition-opacity">
        <CopyFieldButton
          copiedKey={copiedKey}
          copyValue={value}
          label="Копировать текст письма"
          onCopy={onCopy}
          value={value}
        />
      </div>
    </div>
  )
}

function EmptyPreview({ icon: Icon, title, description }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-300 bg-slate-50/80 p-6 text-center">
      <div className="rounded-full bg-white p-3 text-slate-400 shadow-sm">
        <Icon className="size-5" />
      </div>
      {title ? <p className="mt-4 text-sm font-medium text-slate-700">{title}</p> : null}
      <p className={cn("max-w-xs text-sm leading-6 text-slate-500", title ? "mt-1" : "mt-4")}>{description}</p>
    </div>
  )
}

function PushPreview({ item, copiedKey, onCopy }) {
  const hasPush = item.pushTitle || item.pushSubtitle

  if (!hasPush) {
    return (
      <EmptyPreview
        description="Для этого статуса пуш не отправляем"
        icon={Bell}
        title=""
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_24px_80px_-48px_rgba(15,23,42,0.55)]">
        <div className="bg-slate-50 px-3.5 py-3 text-slate-900">
          <div className="flex items-start gap-3">
            <div className="h-7 w-7 shrink-0 overflow-hidden">
              <img alt="Avito" className="h-full w-full object-cover object-center" src={avitoPushIcon} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-h-7 items-center gap-2">
                <p className="min-w-0 flex-1 text-[13px] font-semibold leading-4 text-slate-900">
                  {renderHighlightedText(item.pushTitle)}
                </p>
                <div className="shrink-0">
                  <CopyFieldButton
                    copiedKey={copiedKey}
                    copyValue={item.pushTitle}
                    label="Копировать заголовок пуша"
                    onCopy={onCopy}
                    value={item.pushTitle}
                  />
                </div>
              </div>
              <div className="mt-0.5 flex items-start gap-2">
                <p className="min-w-0 flex-1 text-[13px] leading-4 text-slate-500">
                  {renderHighlightedText(item.pushSubtitle)}
                </p>
                <div className="shrink-0 pt-0.5">
                  <CopyFieldButton
                    copiedKey={copiedKey}
                    copyValue={item.pushSubtitle}
                    label="Копировать подзаголовок пуша"
                    onCopy={onCopy}
                    value={item.pushSubtitle}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmailPreview({ item, copiedKey, onCopy }) {
  const hasEmail = item.emailSubject || item.emailSnippet || item.emailTitle || item.emailBody || item.emailButton

  if (!hasEmail) {
    return (
      <EmptyPreview
        description="Для этого статуса письмо пока не задано."
        icon={Mail}
        title="Письма нет"
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_24px_80px_-48px_rgba(15,23,42,0.55)]">
        <div className="border-b border-slate-200 bg-slate-50 px-3.5 py-2.5">
          <div className="min-w-0 space-y-1">
              <CopyableTextPair
                copiedKey={copiedKey}
                label="Копировать тему письма"
                onCopy={onCopy}
                value={item.emailSubject || "Тема письма"}
              >
                <p className="truncate text-[13px] font-semibold leading-4 text-slate-900">
                  {renderHighlightedText(item.emailSubject || "Тема письма")}
                </p>
              </CopyableTextPair>
              <CopyableTextPair
                copiedKey={copiedKey}
                label="Копировать сниппет письма"
                onCopy={onCopy}
                value={item.emailSnippet}
              >
                <p className="truncate text-[13px] leading-4 text-slate-500">{renderHighlightedText(item.emailSnippet)}</p>
              </CopyableTextPair>
          </div>
        </div>

        <div className="space-y-3 bg-white px-3.5 py-3.5">
          <CopyableText
            as="h3"
            className="text-center text-[17px] font-semibold leading-6 text-slate-900"
            copiedKey={copiedKey}
            label="Копировать заголовок письма"
            onCopy={onCopy}
            value={item.emailTitle}
          />
          <EmailBodyBlock copiedKey={copiedKey} onCopy={onCopy} value={item.emailBody} />
          {item.emailButton ? (
            <div className="group flex items-start gap-2 pt-1">
              <div className="flex min-w-0 flex-1 justify-center">
                <div
                  className="inline-flex items-center px-3.5 py-1.5 text-[13px] font-medium text-white"
                  style={{ backgroundColor: "#05AAFF", borderRadius: "22px" }}
                >
                  <span>{renderHighlightedText(item.emailButton, "text-white/90")}</span>
                </div>
              </div>
              <div className="shrink-0 pt-0.5 opacity-100 transition-opacity">
                <CopyFieldButton
                  copiedKey={copiedKey}
                  copyValue={item.emailButton}
                  label="Копировать кнопку письма"
                  onCopy={onCopy}
                  value={item.emailButton}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function CommunicationCard({ item, copiedKey, onCopy }) {
  const lastUpdatedLabel = formatLastUpdated(item.lastTextChangeAt)

  return (
    <article className="overflow-hidden rounded-[36px] border border-slate-200 bg-white/95 shadow-[0_26px_80px_-50px_rgba(15,23,42,0.45)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{item.statusLabel}</h2>
          {lastUpdatedLabel ? (
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-slate-500">
              <Clock3 className="size-3.5" />
              <span>Обновлено {lastUpdatedLabel}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {item.statusNote ? (
            <div className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
              {item.statusNote}
            </div>
          ) : null}
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
            <Package className="size-3.5" />
            {item.segment} · {item.deliveryType}
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
        <section className="p-0.5">
          <PushPreview copiedKey={copiedKey} item={item} onCopy={onCopy} />
        </section>

        <section className="p-0.5">
          <EmailPreview copiedKey={copiedKey} item={item} onCopy={onCopy} />
        </section>
      </div>
    </article>
  )
}

function App() {
  const segmentOptions = SEGMENTS.filter((segment) => segment === "B2C" || communications.some((item) => item.segment === segment))
  const [selectedSegment, setSelectedSegment] = useState(segmentOptions[0] ?? "C2C")
  const [selectedDeliveryType, setSelectedDeliveryType] = useState("")
  const [selectedStatuses, setSelectedStatuses] = useState([])
  const [statusSearchQuery, setStatusSearchQuery] = useState("")
  const [updatedSince, setUpdatedSince] = useState("")
  const [dateSortMode, setDateSortMode] = useState("none")
  const [copiedKey, setCopiedKey] = useState("")
  const statusSectionRefs = useRef({})

  const deliveryTypes = getDeliveryTypes(selectedSegment)
  const statuses = getStatuses(selectedSegment, selectedDeliveryType)
  const filteredStatuses = statuses.filter((status) => statusMatchesSearch(status, statusSearchQuery))

  useEffect(() => {
    if (!deliveryTypes.length) {
      setSelectedDeliveryType("")
      return
    }

    if (!deliveryTypes.includes(selectedDeliveryType)) {
      setSelectedDeliveryType(deliveryTypes[0])
    }
  }, [deliveryTypes, selectedDeliveryType])

  useEffect(() => {
    setSelectedStatuses(statuses)
    setStatusSearchQuery("")
  }, [selectedSegment, selectedDeliveryType])

  const visibleCommunications = sortCommunicationsByDate(
    communications.filter((item) => {
      return (
        item.segment === selectedSegment &&
        item.deliveryType === selectedDeliveryType &&
        selectedStatuses.includes(item.statusLabel) &&
        statusMatchesSearch(item.statusLabel, statusSearchQuery) &&
        matchesUpdatedSince(item.lastTextChangeAt, updatedSince)
      )
    }),
    dateSortMode
  )

  const handleCopy = async (key, value) => {
    if (!value) {
      return
    }

    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      window.setTimeout(() => {
        setCopiedKey((currentKey) => (currentKey === key ? "" : currentKey))
      }, 1400)
    } catch (error) {
      console.error("Clipboard copy failed", error)
    }
  }

  const toggleStatus = (status) => {
    setSelectedStatuses((currentStatuses) => {
      if (currentStatuses.includes(status)) {
        if (currentStatuses.length === 1) {
          return currentStatuses
        }

        return currentStatuses.filter((item) => item !== status)
      }

      return statuses.filter((item) => currentStatuses.includes(item) || item === status)
    })
  }

  const scrollToStatus = (status) => {
    const target = statusSectionRefs.current[status]

    if (!target) {
      return
    }

    target.scrollIntoView({
      behavior: "smooth",
      block: "start"
    })
  }

  const hasDataInSegment = deliveryTypes.length > 0

  return (
    <main className="min-h-screen bg-[#f6f7f9] px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div>
        <div className="grid gap-8 xl:grid-cols-[480px_minmax(0,1fr)]">
          <aside className="xl:sticky xl:top-6 xl:self-start">
            <div className="space-y-4 rounded-[32px] border border-slate-200 bg-slate-50/75 p-4 shadow-[0_24px_80px_-56px_rgba(15,23,42,0.35)] sm:p-4">
              <section className="space-y-3">
                <p className="text-sm font-medium text-slate-500">Сегмент аудитории</p>
                <div className="grid w-full grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-1">
                  {segmentOptions.map((segment) => (
                    <button
                      key={segment}
                      className={cn(
                        "rounded-xl border px-4 py-2 text-sm font-medium transition-colors",
                        selectedSegment === segment
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-100"
                      )}
                      onClick={() => setSelectedSegment(segment)}
                      type="button"
                    >
                      {segment}
                    </button>
                  ))}
                </div>
              </section>

              {hasDataInSegment ? (
                <>
                  <section className="space-y-2.5">
                    <p className="text-sm font-medium text-slate-500">Способ доставки</p>
                    <div className="flex flex-wrap gap-2">
                      {deliveryTypes.map((deliveryType) => (
                        <button
                          key={deliveryType}
                          className={cn(
                            "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                            selectedDeliveryType === deliveryType
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-100"
                          )}
                          onClick={() => setSelectedDeliveryType(deliveryType)}
                          type="button"
                        >
                          {deliveryType}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="space-y-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-slate-500">Фильтр по статусам</p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          className="rounded-full"
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedStatuses(statuses)}
                        >
                          <CheckCheck className="size-3.5" />
                          Выбрать все
                        </Button>
                        <Button
                          className="rounded-full"
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedStatuses([])}
                        >
                          <X className="size-3.5" />
                          Снять все
                        </Button>
                      </div>
                    </div>

                    <div className="relative mt-3">
                      <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                      <input
                        className="h-10 w-full rounded-full border border-slate-200 bg-white pl-10 pr-11 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                        onChange={(event) => setStatusSearchQuery(event.target.value)}
                        placeholder="Начните вводить название..."
                        type="text"
                        value={statusSearchQuery}
                      />
                      {statusSearchQuery ? (
                        <button
                          aria-label="Очистить поиск по статусам"
                          className="absolute right-3 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                          onClick={() => setStatusSearchQuery("")}
                          title="Очистить поиск"
                          type="button"
                        >
                          <X className="size-4" />
                        </button>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {filteredStatuses.map((status) => {
                        const active = selectedStatuses.includes(status)

                        return (
                          <div
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border transition-colors",
                              active
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-100"
                            )}
                            key={status}
                          >
                            <button
                              className="px-2 py-1 text-left text-xs leading-4"
                              onClick={() => toggleStatus(status)}
                              type="button"
                            >
                              {status}
                            </button>
                            <button
                              aria-label={`Перейти к статусу ${status}`}
                              className={cn(
                                "mr-1 inline-flex size-5 items-center justify-center rounded-full transition",
                                active ? "hover:bg-white/12" : "hover:bg-slate-200"
                              )}
                              onClick={() => scrollToStatus(status)}
                              title="Перейти к этой коммуникации"
                              type="button"
                            >
                              <ArrowRight className="size-3.5" />
                            </button>
                          </div>
                        )
                      })}
                    </div>

                    {filteredStatuses.length ? null : (
                      <p className="text-sm leading-6 text-slate-500">По этому способу доставки статусы по запросу не найдены.</p>
                    )}
                  </section>

                </>
              ) : (
                <section className="space-y-3">
                  <p className="text-sm font-medium text-slate-500">Для сегмента {selectedSegment} пока не загружены данные.</p>
                  <p className="text-sm leading-6 text-slate-600">
                    Как только пришлёшь CSV с этим сегментом, вкладка автоматически начнёт показывать коммуникации.
                  </p>
                </section>
              )}
            </div>
          </aside>

          <section className="space-y-5">
            {hasDataInSegment ? (
              <>
                <section className="sticky top-6 z-10 rounded-[28px] border border-slate-200 bg-slate-50 p-4 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.28)] sm:p-5">
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-end">
                    <div>
                      <p className="text-sm font-medium text-slate-500">Показать только с датой обновления с</p>
                      <DateFilterField
                        max={toDateInputValue(new Date().toISOString())}
                        onChange={setUpdatedSince}
                        onClear={() => setUpdatedSince("")}
                        value={updatedSince}
                      />
                    </div>

                    <div>
                      <p className="text-sm font-medium text-slate-500">Сортировать по дате обновления</p>
                      <div className="relative mt-3 block">
                        <select
                          className="h-10 w-full appearance-none rounded-full border border-slate-200 bg-white pl-4 pr-11 text-sm text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                          onChange={(event) => setDateSortMode(event.target.value)}
                          value={dateSortMode}
                        >
                          {DATE_SORT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                      </div>
                    </div>
                  </div>
                </section>

                {visibleCommunications.length ? (
                  visibleCommunications.map((item) => (
                    <div
                      className="scroll-mt-36"
                      key={item.id}
                      ref={(node) => {
                        if (node) {
                          statusSectionRefs.current[item.statusLabel] = node
                        }
                      }}
                    >
                      <CommunicationCard copiedKey={copiedKey} item={item} onCopy={handleCopy} />
                    </div>
                  ))
                ) : (
                  <div className="rounded-[32px] border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center">
                    <p className="text-sm font-medium text-slate-600">По текущим фильтрам коммуникации не найдены.</p>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-[32px] border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center">
                <p className="text-sm font-medium text-slate-600">Здесь появятся превью коммуникаций, когда для сегмента загрузятся данные.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

export default App
