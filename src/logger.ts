import safeStringify from 'fast-safe-stringify'

type LogLevel = 'log' | 'debug' | 'error' | 'warn' | 'info'

interface LogData {
  app: string
  env: string
  source?: string | null
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
  #tagName?: string
  requestStartTime: number
  defaultLogData: LogData
  metaDetails: Record<string, unknown>
  logs: LogData[]

  /**
   * Logger constructor
   * @param {Request} source
   */
  constructor(key: string, name: string, environment: string, source: Request | ScheduledController, tagName?: string) {
    const url = source instanceof Request ? new URL(source.url) : null
    this.#key = key
    this.#hostname = url?.hostname ?? 'cronjob'
    this.#tagName = tagName
    this.requestStartTime = Date.now()
    this.defaultLogData = this.buildDefaultLogData(name, environment, source)
    this.metaDetails = {}
    this.logs = []
    this.extendConsole()
  }

  /**
   * Build up default log data
   * @param source
   * @returns {Object}
   */
  buildDefaultLogData(name: string, environment: string, source: Request | ScheduledController): LogData {
    const commonMeta = { source: environment }
    let requestMeta = {}
    let jobMeta = {}

    if (source instanceof Request) {
      requestMeta = {
        origin: source.headers.get('origin'),
        ua: source.headers.get('user-agent'),
        referer: source.headers.get('Referer') || 'empty',
        ip: source.headers.get('CF-Connecting-IP'),
        countryCode: (source.cf || {}).country,
        colo: (source.cf || {}).colo,
        url: source.url,
        method: source.method,
        x_forwarded_for: source.headers.get('x_forwarded_for') || '0.0.0.0',
        asn: (source.cf || {}).asn,
        cfRay: source.headers.get('cf-ray'),
        tlsCipher: (source.cf || {}).tlsCipher,
        tlsVersion: (source.cf || {}).tlsVersion,
        clientTrustScore: (source.cf || {}).clientTrustScore,
      }
    } else if ('scheduledTime' in source) {
      jobMeta = {
        timestamp: new Date(source.scheduledTime),
      }
    }

    return {
      app: name,
      env: environment || 'unknown',
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
   * Add a meta value to the logs
   * Done this way so each log that contains the meta data no matter when its added after
   * @param {string} metaName
   * @param {string|number} metaValue
   */
  setMeta(metaName: string, metaValue: string | number): void {
    this.metaDetails[metaName] = metaValue
  }

  extendConsole(): void {
    const DEFAULT_CONSOLE_METHODS: LogLevel[] = ['log', 'debug', 'error', 'warn', 'info']
    const [log, debug, error, warn, info] = [console.log, console.debug, console.error, console.warn, console.info]
    const _workerConsole = { log, debug, error, warn, info }

    DEFAULT_CONSOLE_METHODS.forEach((method) => {
      console[method] = (...args: any[]) => {
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
    const tagName = this.#tagName
    const time = Date.now()

    const url = `https://logs.logdna.com/logs/ingest?tags=${tagName}&hostname=${hostname}&now=${time}`

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
