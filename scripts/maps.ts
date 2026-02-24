import {
  buildApplication,
  buildCommand,
  buildRouteMap,
  type CommandContext,
  run as runApp,
} from "@stricli/core";
import { z } from "zod";
import { defineRemoteCommand } from "$lib/remoteCommand";

const searchSchema = z.object({
  query: z.string(),
  location: z.string().optional(),
  reviews: z.boolean().optional(),
  json: z.boolean().optional(),
});

async function geocodeCity(
  city: string,
  apiKey: string,
): Promise<{ lat: number; lng: number }> {
  const res = await fetch(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.location",
      },
      body: JSON.stringify({ textQuery: city, maxResultCount: 1 }),
    },
  );
  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`);
  const data = (await res.json()) as {
    places?: { location?: { latitude: number; longitude: number } }[];
  };
  const loc = data.places?.[0]?.location;
  if (!loc) throw new Error(`Could not geocode "${city}"`);
  return { lat: loc.latitude, lng: loc.longitude };
}

const BASE_FIELDS = [
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.priceLevel",
  "places.editorialSummary",
  "places.currentOpeningHours",
];

function getFieldMask(includeReviews: boolean): string {
  const fields = includeReviews
    ? [...BASE_FIELDS, "places.reviews"]
    : BASE_FIELDS;
  return fields.join(",");
}

function formatPlace(place: any, includeReviews: boolean): string {
  const name = place.displayName?.text ?? "Unknown";
  const address = place.formattedAddress ?? "No address";
  const rating = place.rating ? `⭐ ${place.rating}` : "";
  const count = place.userRatingCount
    ? `(${place.userRatingCount} reviews)`
    : "";
  const price = place.priceLevel
    ? `| ${place.priceLevel.replace("PRICE_LEVEL_", "")}`
    : "";
  const summary = place.editorialSummary?.text;
  const website = place.websiteUri;
  const mapsUrl = place.googleMapsUri;
  const hours = place.currentOpeningHours?.weekdayDescriptions;
  const loc = place.location;

  const lines = [
    `${name}`,
    `  ${address} ${[rating, count, price].filter(Boolean).join(" ")}`,
  ];
  if (loc) lines.push(`  📌 ${loc.latitude}, ${loc.longitude}`);
  if (summary) lines.push(`  ${summary}`);
  if (website) lines.push(`  🔗 ${website}`);
  if (mapsUrl) lines.push(`  📍 ${mapsUrl}`);
  if (hours) lines.push(`  🕐 ${hours.join("; ")}`);

  if (includeReviews) {
    const reviews = place.reviews ?? [];
    for (const review of reviews) {
      const author = review.authorAttribution?.displayName ?? "Anonymous";
      const stars = review.rating ? `⭐ ${review.rating}` : "";
      const time = review.relativePublishTimeDescription ?? "";
      const text = review.text?.text ?? "";
      lines.push(`  💬 ${author} ${stars} ${time}`);
      if (text) lines.push(`     ${text}`);
    }
  }

  return lines.join("\n");
}

const search = defineRemoteCommand({
  name: "maps-search",
  schema: searchSchema,
  server: async ({ query, location, reviews, json }) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey)
      throw new Error("GOOGLE_MAPS_API_KEY environment variable is required");

    const includeReviews = reviews ?? false;
    const body: Record<string, unknown> = { textQuery: query };

    if (location) {
      const { lat, lng } = await geocodeCity(location, apiKey);
      body.locationBias = {
        circle: { center: { latitude: lat, longitude: lng }, radius: 10000 },
      };
    }

    const response = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": getFieldMask(includeReviews),
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Google Maps API error: ${response.status} ${await response.text()}`,
      );
    }

    const data = (await response.json()) as { places?: any[] };
    const places = data.places ?? [];

    if (places.length === 0) return json ? "[]" : "No results found.";

    if (json) return JSON.stringify(places, null, 2);

    return places.map((p) => formatPlace(p, includeReviews)).join("\n\n");
  },
  client: (sendCommand) =>
    buildCommand({
      async func(
        this: CommandContext,
        flags: { location?: string; reviews: boolean; json: boolean },
        query: string,
      ) {
        const result = await sendCommand({
          query,
          location: flags.location,
          reviews: flags.reviews,
          json: flags.json,
        });
        console.log(result);
      },
      parameters: {
        positional: {
          kind: "tuple",
          parameters: [
            {
              brief: "Search query",
              parse: String,
            },
          ],
        },
        flags: {
          location: {
            kind: "parsed",
            parse: String,
            brief: "City or area to bias results to",
            optional: true,
          },
          reviews: {
            kind: "boolean",
            brief: "Include review contents",
            default: false,
          },
          json: {
            kind: "boolean",
            brief: "Output raw JSON",
            default: false,
          },
        },
      },
      docs: {
        brief: "Search for places using Google Maps",
      },
    }),
});

export const mapsCommands = [search];
export const mapsRoutes = buildRouteMap({
  routes: {
    search: search.command,
  },
  docs: {
    brief: "Google Maps CLI commands",
  },
});

if (import.meta.main) {
  const app = buildApplication(mapsRoutes, {
    name: "maps",
  });
  await runApp(app, process.argv.slice(2), { process });
}
