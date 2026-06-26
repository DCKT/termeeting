import { CalendarApi, type Event } from "../../src/calendar/CalendarApi.js"
import { Effect, Layer } from "effect"

export const makeTest = (events?: readonly Event[]): Layer.Layer<CalendarApi> =>
  Layer.succeed(CalendarApi, {
    getEvents: () => Effect.succeed({ events: events ?? [], workingLocations: [] }),
  })
