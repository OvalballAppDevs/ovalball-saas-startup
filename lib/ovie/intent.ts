import "server-only"

import Anthropic from "@anthropic-ai/sdk"

import type { OvieTurn } from "./types"

/**
 * Ovie's ONLY point of contact with an LLM. This module's sole job is
 * message + conversation history -> ONE typed OvieIntent -- structured
 * tool-use only, never free-text-to-database parsing, and never a
 * canonical id trusted from the model (a team/club is always described
 * here in natural language -- "Burnley U12", "our U12s" -- and resolved
 * against the real database deterministically in lib/ovie/orchestrator.ts,
 * exactly as the brief requires: "The LLM never has service-role
 * credentials, never invents canonical IDs, never decides permissions or
 * rankings.").
 *
 * Mirrors the honest-degradation pattern already used by
 * lib/address-lookup/lookup.ts: no ANTHROPIC_API_KEY configured -> a
 * typed `not_configured` result, never a silent fake reply. Confirmed
 * absent in this local environment (no key in .env.local/.env.example),
 * so extractOvieIntent() cannot be live-exercised here -- see the Ovie
 * Phase 1 report's LIVE TEST RESULTS section for how this is disclosed
 * and what was proven instead (every downstream step, driven by
 * hand-constructed OvieIntent values that a real model call would
 * otherwise have produced).
 */

export type RugbyCode = "union" | "league"

export interface OvieCriteriaDelta {
  teamDescription?: string // e.g. "Burnley U12", "our U12s" -- resolved against the actor's own manageable teams in the orchestrator, never treated as an id
  date?: string // absolute ISO yyyy-mm-dd -- the model resolves "23/9/26"/"next Saturday" itself from the conversation and today's date given in its system prompt; the orchestrator never re-interprets a relative phrase
  radiusMiles?: number
  homeAwayPreference?: "home" | "away" | null
  partnerPreference?: "prefer" | "only" | "ignore"
  maxPreviousMeetings?: number | null
  excludeTeamDescription?: string // "don't show anyone we're already playing twice" is expressed as maxPreviousMeetings, but an explicit named exclusion ("not Rossendale") lands here
}

export type OvieIntent =
  | { kind: "search_opponents"; delta: OvieCriteriaDelta; freshSearch: boolean } // freshSearch=true when the date or team changed -- forces a full re-run, never a stale-result reuse, per the brief's explicit rule
  | { kind: "select_candidate"; description: string } // "Rossendale", "the second one" -- resolved against the last shown result list in the orchestrator, never an id from the model
  | { kind: "prepare_fixture_request"; venuePreference: "home" | "away" | "either"; kickoffTime: string | null; note: string | null }
  | { kind: "confirm_send" }
  | { kind: "cancel" }
  | { kind: "clarify"; question: string } // model needs one more piece of information before it can act
  | { kind: "narrate"; message: string } // small talk, an out-of-scope question, or a plain informational answer -- no action taken

export type IntentResult = { status: "ok"; intent: OvieIntent } | { status: "not_configured" } | { status: "error"; message: string }

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_opponents",
    description:
      "Search for a suitable opposition team for one of the user's own teams. Call this whenever the user asks to find/book/arrange a fixture or opponent, or refines a search already in progress (different radius, partner-only, exclude someone, a new date). Only include fields the user has actually specified or changed this turn -- omitted fields keep their previous value.",
    input_schema: {
      type: "object",
      properties: {
        teamDescription: { type: "string", description: "Natural-language description of the user's own team, e.g. 'Burnley U12' or 'our U12s'. Omit if unchanged from the current search." },
        date: { type: "string", description: "The fixture date resolved to absolute ISO yyyy-mm-dd from the conversation and today's date. Omit if unchanged." },
        radiusMiles: { type: "number", description: "Search radius in miles. Omit if unchanged." },
        homeAwayPreference: { type: "string", enum: ["home", "away"], description: "Omit if no preference stated." },
        partnerPreference: { type: "string", enum: ["prefer", "only", "ignore"], description: "'only' when the user says something like 'only partners' or 'just our partner clubs'." },
        maxPreviousMeetings: { type: "number", description: "Exclude opponents already met this many times this season or more, e.g. 2 for 'don't show anyone we're already playing twice'." },
        excludeTeamDescription: { type: "string", description: "A specific opponent to exclude by name, if the user names one." },
        freshSearch: { type: "boolean", description: "true if the date or the user's own team changed this turn (availability must be recalculated from scratch), false for any other refinement." },
      },
      required: ["freshSearch"],
    },
  },
  {
    name: "select_candidate",
    description: "Call when the user picks one of the candidates from the last search results by name or position (\"Rossendale\", \"the second one\", \"the top one\").",
    input_schema: { type: "object", properties: { description: { type: "string" } }, required: ["description"] },
  },
  {
    name: "prepare_fixture_request",
    description: "Call once venue and kickoff details for the selected candidate are known, to build the confirmation card. Do not call this before a candidate has been selected.",
    input_schema: {
      type: "object",
      properties: {
        venuePreference: { type: "string", enum: ["home", "away", "either"] },
        kickoffTime: { type: "string", description: "24-hour HH:MM, or null if not specified." },
        note: { type: "string", description: "Any extra note the user gave for the request." },
      },
      required: ["venuePreference"],
    },
  },
  {
    name: "confirm_send",
    description: "Call ONLY when the user has explicitly confirmed sending the fixture request shown on a confirmation card (e.g. 'yes', 'send it', 'confirm'). Never call this to merely acknowledge information.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "cancel",
    description: "Call when the user explicitly abandons the current search or draft request.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "clarify",
    description: "Call when you need one more piece of information before you can search or prepare a request.",
    input_schema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
  },
  {
    name: "narrate",
    description: "Call for small talk, out-of-scope questions, or anything that needs a plain reply with no search or write action.",
    input_schema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
  },
]

function systemPrompt(todayIso: string): string {
  return [
    "You are Ovie, Ovalball's rugby fixture assistant. You help club volunteers find and arrange fixtures for their teams.",
    `Today's date is ${todayIso}.`,
    "You NEVER decide who is available, who is eligible, or what any team's identity/id is -- you only extract what the user said into the search_opponents/select_candidate/prepare_fixture_request tools as natural-language descriptions. A separate, deterministic part of Ovalball resolves those descriptions against the real database and enforces every permission and eligibility rule -- you have no visibility into that data and must never guess or state a club's availability, contact details, or any fact not given back to you in this conversation.",
    "Tone: warm, professional, concise, and British. Never pushy, never over-familiar.",
    "You must ALWAYS reply by calling exactly one of the provided tools -- never plain text.",
    "Only call confirm_send when the user has just been shown a confirmation card and clearly says to send it. Never send a fixture request the user has not seen and explicitly approved.",
  ].join(" ")
}

function toolUseToIntent(block: Anthropic.ToolUseBlock): OvieIntent {
  const input = block.input as Record<string, unknown>
  switch (block.name) {
    case "search_opponents": {
      const { freshSearch, ...delta } = input as unknown as OvieCriteriaDelta & { freshSearch: boolean }
      return { kind: "search_opponents", delta, freshSearch: Boolean(freshSearch) }
    }
    case "select_candidate":
      return { kind: "select_candidate", description: String(input.description ?? "") }
    case "prepare_fixture_request":
      return {
        kind: "prepare_fixture_request",
        venuePreference: (input.venuePreference as "home" | "away" | "either") ?? "either",
        kickoffTime: typeof input.kickoffTime === "string" ? input.kickoffTime : null,
        note: typeof input.note === "string" ? input.note : null,
      }
    case "confirm_send":
      return { kind: "confirm_send" }
    case "cancel":
      return { kind: "cancel" }
    case "clarify":
      return { kind: "clarify", question: String(input.question ?? "") }
    case "narrate":
    default:
      return { kind: "narrate", message: String(input.message ?? "") }
  }
}

export async function extractOvieIntent(message: string, history: OvieTurn[], todayIso: string): Promise<IntentResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { status: "not_configured" }
  }

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 1024,
      system: systemPrompt(todayIso),
      tools: TOOLS,
      tool_choice: { type: "any" },
      messages: [...history.map((t) => ({ role: t.role, content: t.content })), { role: "user" as const, content: message }],
    })

    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    if (!toolUse) {
      return { status: "error", message: "Ovie did not return a recognised action." }
    }
    return { status: "ok", intent: toolUseToIntent(toolUse) }
  } catch (err) {
    console.error("extractOvieIntent failed:", err)
    return { status: "error", message: "Ovie is temporarily unavailable." }
  }
}
