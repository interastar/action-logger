import safeStringify from 'fast-safe-stringify'

type LogLevel = 'log' | 'debug' | 'error' | 'warn' | 'info'

interface LogData {
  app: string
  env: string
  source?: string | null
  target?: string | null
  [key: string]: unknown
  meta: {
    source?: string | null
    ua?: string | null
    referer?: string | null
    ip?: string | null
    countryCode?: string | null
    colo?: string | null
    url?: string | null
    method?: string | null
    x_forwarded_for?: string | null
    asn?: number | null
    cfRay?: string | null
    tlsCipher?: string | null
    tlsVersion?: string | null
    clientTrustScore?: number | null
    executionTime?: number | null
    [key: string]: unknown
  }
}

const stringify = (obj: unknown) => safeStringify(obj)

/**
 * LogDNA logger using their API
 */
export class Logger {
  #key: string
  #hostname: string
  #tags: string[]
  requestStartTime: number
  defaultLogData: LogData
  metaDetails: Record<string, unknown>
  logs: LogData[]

  /**
   * Logger constructor
   * @param {Request} origin
   */
  constructor(key: string, name: string, environment?: string, source?: string, origin?: Request | ScheduledController, body?: string, tags?: string) {
    const url = origin instanceof Request ? new URL(origin.url) : null
    this.#key = key
    this.#tags = tags?.split(/[ ,]+/).filter(Boolean) || []
    this.#hostname = url?.hostname ?? 'unknown'
    this.requestStartTime = Date.now()
    this.defaultLogData = this.buildDefaultLogData(name, environment, source, origin, body)
    this.metaDetails = {}
    this.logs = []
    this.extendConsole()
  }

  /**
   * Build up default log data
   * @param origin
   * @returns {Object}
   */
  buildDefaultLogData(name: string, environment: string | undefined, source: string | undefined, origin?: Request | ScheduledController, body?: string): LogData {
    const url = origin instanceof Request ? new URL(origin.url) : null
    const commonMeta = { source: source }
    let requestMeta = {}
    let jobMeta = {}

    this.#hostname = url?.hostname ?? 'unknown'

    if (origin instanceof Request) {
      requestMeta = {
        origin: origin.headers.get('origin'),
        ua: origin.headers.get('user-agent'),
        referer: origin.headers.get('Referer') || 'empty',
        ip: origin.headers.get('CF-Connecting-IP'),
        countryCode: (origin.cf || {}).country,
        colo: (origin.cf || {}).colo,
        url: origin.url,
        method: origin.method,
        x_forwarded_for: origin.headers.get('x_forwarded_for') || '0.0.0.0',
        asn: (origin.cf || {}).asn,
        cfRay: origin.headers.get('cf-ray'),
        tlsCipher: (origin.cf || {}).tlsCipher,
        tlsVersion: (origin.cf || {}).tlsVersion,
        clientTrustScore: (origin.cf || {}).clientTrustScore,
        headers: Object.fromEntries(origin.headers),
      }
    } else if (origin && 'scheduledTime' in origin) {
      this.#hostname = 'cronjob'
      jobMeta = {
        timestamp: new Date(origin.scheduledTime),
      }
    }

    this.setMeta('requestBody', body)

    return {
      app: name,
      env: environment || 'unknown',
      source: source,
      meta: { ...commonMeta, ...requestMeta, ...jobMeta },
    }
  }

  /**
   * Push the log into and array so it can be sent later
   * This method should not be used directly. Instead use the error/debug/info methods to log
   * @param {string} message
   * @param {LogLevel} level
   */
  addLog(message: string, level: LogLevel): void {
    const lineLog = {
      line: message,
      timestamp: Date.now(),
      level: level,
      ...this.defaultLogData,
    }
    lineLog.meta = {
      ...lineLog.meta,
      ...this.metaDetails,
    }
    this.logs.push(lineLog)
  }

  /**
   * Add an INFO level log
   * @param {string} message
   */
  info(message: string): void {
    this.addLog(message, 'info')
  }

  /**
   * Add an DEBUG level log
   * @param {string} message
   */
  debug(message: string): void {
    this.addLog(message, 'debug')
  }

  /**
   * Add an ERROR level log
   * @param {string} message
   */
  error(message: string): void {
    this.addLog(message, 'error')
  }

  /**
   * Add a data value to the logs
   * Done this way so each log that contains the data no matter when its added after
   * @param {string} dataName
   * @param {string | number | null | undefined} dataValue
   */
  setData(dataName: string, dataValue: string | number | null | undefined): void {
    if (dataValue === undefined) return

    this.defaultLogData[dataName] = dataValue
  }

  /**
   * Add a meta value to the logs
   * Done this way so each log that contains the meta data no matter when its added after
   * @param {string} metaName
   * @param {string|number} metaValue
   */
  setMeta(metaName: string, metaValue: string | number | null | undefined): void {
    if (metaValue === undefined) return

    this.metaDetails[metaName] = metaValue
  }

  /**
   * Add a new tag to the tag list
   * @param {string} value
   */
  setTag(tag: string | undefined): void {
    if (tag === undefined) return

    this.#tags.push(tag)
  }

  extendConsole(): void {
    const DEFAULT_CONSOLE_METHODS: LogLevel[] = ['log', 'debug', 'error', 'warn', 'info']
    const [log, debug, error, warn, info] = [console.log, console.debug, console.error, console.warn, console.info]
    const _workerConsole = { log, debug, error, warn, info }

    DEFAULT_CONSOLE_METHODS.forEach((method) => {
      console[method] = (...args: string[]) => {
        this.addLog(args.length > 1 ? stringify(args) : args[0], method as LogLevel)

        _workerConsole[method](...args)
        return
      }
    })
  }

  /**
   * Post the request to LogDNA
   * This should be used at the end of of the users request
   * When it fails, or when it succeeds
   * @returns {Promise<void>}
   */
  async postRequest(): Promise<void> {
    const token = this.#key
    const hostname = this.#hostname
    const time = Date.now()
    const tags = this.#tags

    const paramsObj = tags.map((s) => ['tags', s] as [key: string, value: string])
    paramsObj.push(['hostname', hostname])
    paramsObj.push(['time', time.toString()])

    const params = new URLSearchParams(paramsObj)

    const url = `https://logs.logdna.com/logs/ingest?${params}`

    // add the executionTime to each of the logs for visibility
    this.logs.forEach((log) => {
      log.meta.executionTime = time - this.requestStartTime
    })

    const body = this.logs.length > 0 ? JSON.stringify({ lines: this.logs }) : null

    try {
      const options = {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          //Authorization: 'Basic Y2EwMTg4OWFmMjVkMzgxYWI5NDkyZjRkYzI4ZmU3M2U6',
          apikey: token,
        },
        body,
      }

      await fetch(url, options)
    } catch (error: unknown) {
      if (typeof error === 'string') {
        console.error(error)
      } else if (error instanceof Error) {
        console.error(`${error.message}: ${error?.stack}`)
      }
    }
  }
}
