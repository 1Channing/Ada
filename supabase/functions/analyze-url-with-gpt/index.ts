import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface UrlAnalysisContext {
  brand?: string;
  model?: string;
  year?: string;
  mileage?: string;
  fuel?: string;
  trim?: string;
  site?: string;
}

interface RequestBody {
  url: string;
  context?: UrlAnalysisContext;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const openAiKey = Deno.env.get("OPENAI_API_KEY");

    if (!openAiKey) {
      return new Response(
        JSON.stringify({
          status: "not_available",
          reason: "server-side GPT endpoint not configured",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: RequestBody = await req.json();
    const { url, context = {} } = body;

    if (!url) {
      return new Response(
        JSON.stringify({ status: "error", reason: "url is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contextLines = Object.entries(context)
      .filter(([, v]) => v)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n");

    const prompt = `You are analyzing a car marketplace search URL to identify which URL parameters correspond to which car attributes.

URL to analyze:
${url}

Expected car attributes (some may be present in the URL, some may not):
${contextLines || "  (no context provided)"}

Your task:
1. Parse the URL (query params, hash params, path segments)
2. For each URL parameter, identify which car attribute it represents
3. Identify sort/order parameters if present
4. Suggest a URL template using {brand}, {model}, {yearFrom}, {yearTo}, {mileage}, {fuel}, {trim} placeholders

Respond ONLY with a JSON object in this exact shape (no explanation outside JSON):
{
  "inferredParams": {
    "brandParam": "param_name_or_null",
    "modelParam": "param_name_or_null",
    "yearFromParam": "param_name_or_null",
    "yearToParam": "param_name_or_null",
    "mileageParam": "param_name_or_null",
    "fuelParam": "param_name_or_null",
    "trimParam": "param_name_or_null",
    "sortParam": "param_name_or_null"
  },
  "explanation": "brief explanation of what was found",
  "confidence": 0.0,
  "suggestedTemplate": "https://..."
}

confidence must be between 0.0 and 1.0 based on how many params you could identify.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(
        JSON.stringify({ status: "error", reason: `OpenAI error: ${response.status}`, detail: errText }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const completion = await response.json();
    const rawContent = completion.choices?.[0]?.message?.content ?? "{}";

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      return new Response(
        JSON.stringify({ status: "error", reason: "GPT returned non-JSON response", raw: rawContent }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ status: "ok", ...parsed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ status: "error", reason: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
