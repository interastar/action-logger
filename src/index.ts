/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { Hono } from 'hono'
import { Logger } from './logger'

interface Env {
  LogDNA: string
}

const app = new Hono<Env>()

function redirectRequest(request: Request, newHost?: string | null, newPort?: string | null): Request {
  /**
   * The best practice is to only assign new RequestInit properties
   * on the request object using either a method or the constructor
   */
  const newRequestInit: RequestInit = {
    // Change method
    method: request.method,
    // Change headers, note this method will erase existing headers
    headers: request.headers,
    // Change body
    body: request.body,
    // Change the redirect mode.
    redirect: request.redirect,
    // Change a Cloudflare feature on the outbound response
    //cf: { apps: false },
  }

  // Change just the host
  const url = new URL(request.url)
  if (newHost) url.hostname = newHost
  if (newPort) url.port = newPort

  // Best practice is to always use the original request to construct the new request
  // to clone all the attributes. Applying the URL also requires a constructor
  // since once a Request has been constructed, its URL is immutable.
  //return new Request(url.toString(), new Request(request, newRequestInit));
  return new Request(url.toString(), new Request(request))
}

app.all('/*', (c) => {
  const host = c.req.headers.get('Redirect-Host')
  const port = c.req.headers.get('Redirect-Port')
  const org = c.req.headers.get('Origin-Org')
  const name = c.req.headers.get('Origin-Name') ?? 'Unknown'

  console.log(JSON.stringify(c.env))

  // if (!host) return c.json({ message: 'Missing host' }, 404)
  if (!org) return c.json({ message: 'Unknown org' }, 404)
  if (!c.env.LogDNA) return c.json({ message: 'Logging off' }, 500)

  const request = redirectRequest(c.req, host, port)

  const logger = new Logger(c.env.LogDNA, 'action.logger', org, request, name)
  console.log(`Action ${name} called from  ${org}`)

  c.executionCtx.waitUntil(logger.postRequest())

  return fetch(request)
})

export default app
