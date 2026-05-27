import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  // We need an API key to get current prices. Finnhub works.
  const finnhubKey = Deno.env.get("FINNHUB_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!finnhubKey || !supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({ error: "Missing env vars" }), { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Fetch all unresolved predictions
  const { data: predictions, error } = await supabase
    .from("predictions")
    .select("*")
    .is("resolved_correctly", null);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  // Helper to add trading days
  const addTradingDays = (dateStr: string, days: number) => {
    let date = new Date(dateStr);
    let added = 0;
    while (added < days) {
      date.setDate(date.getDate() + 1);
      const day = date.getDay();
      if (day !== 0 && day !== 6) { // Skip weekends
        added++;
      }
    }
    return date;
  };

  const now = new Date();
  const matured = [];

  for (const p of predictions) {
    if (p.base_price === null) continue;
    
    const horizonDays = p.horizon === '5d' ? 5 : 1;
    const targetDate = addTradingDays(p.created_at, horizonDays);
    
    // Set target to end of trading day (approx 4 PM ET = 20:00 UTC)
    targetDate.setUTCHours(20, 0, 0, 0);

    if (now >= targetDate) {
      matured.push({ 
        ...p, 
        _targetDate: targetDate.toISOString().split('T')[0] 
      });
    }
  }

  const results = [];
  if (matured.length > 0) {
    try {
      // Build unique checks for backend
      const uniqueChecks: Record<string, any> = {};
      for (const p of matured) {
        const key = `${p.ticker}_${p._targetDate}`;
        if (!uniqueChecks[key]) {
          uniqueChecks[key] = { ticker: p.ticker, date: p._targetDate };
        }
      }

      const backendUrl = Deno.env.get("API_BASE_URL") || "https://sp500-predictor-697399258111.us-central1.run.app";
      const serviceToken = Deno.env.get("SERVICE_TOKEN") || "dev_service_token_123";

      const res = await fetch(`${backendUrl}/api/historical_prices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceToken}`
        },
        body: JSON.stringify({ checks: Object.values(uniqueChecks) })
      });

      if (res.ok) {
        const data = await res.json();
        const prices = data.prices;

        for (const p of matured) {
          const key = `${p.ticker}_${p._targetDate}`;
          const actualPrice = prices[key];

          if (actualPrice !== undefined && actualPrice !== null) {
            const wentUp = actualPrice > p.base_price;
            const predictedUp = p.predicted_direction === "UP";
            const resolvedCorrectly = wentUp === predictedUp;

            await supabase
              .from("predictions")
              .update({
                resolved_correctly: resolvedCorrectly
              })
              .eq("id", p.id);
              
            results.push({ id: p.id, ticker: p.ticker, resolvedCorrectly });
          }
        }
      } else {
        console.error("Backend historical prices returned status:", res.status);
      }
    } catch (e) {
      console.error("Failed to fetch historical prices from backend", e);
    }
  }

  // 1b. Cleanup predictions older than 90 days (TTL)
  try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const { error: deleteError } = await supabase
      .from("predictions")
      .delete()
      .lt("created_at", ninetyDaysAgo.toISOString());
      
    if (deleteError) {
      console.error("Failed to prune old predictions:", deleteError);
    } else {
      console.log("Successfully pruned predictions older than 90 days");
    }
  } catch (e) {
    console.error("Cleanup error:", e);
  }

  // 2. Check for upcoming earnings
  console.log("Checking for upcoming earnings...");
  const { data: watchlist, error: watchlistError } = await supabase
    .from("watchlist")
    .select("ticker, user_id");

  if (!watchlistError && watchlist) {
    // Get unique tickers
    const uniqueTickers = [...new Set(watchlist.map(item => item.ticker))];
    const earningsAlerts = [];

    for (const ticker of uniqueTickers) {
      try {
        const res = await fetch(`https://financialmodelingprep.com/api/v3/earning_calendar/${ticker}?apikey=${Deno.env.get("FMP_API_KEY") || finnhubKey}`);
        const data = await res.json();
        
        if (data && data.length > 0) {
          const next = data[0];
          const eDate = new Date(next.date);
          const diffDays = (eDate.getTime() - now.getTime()) / (1000 * 3600 * 24);
          
          if (diffDays >= 0 && diffDays <= 5) {
            console.log(`ALERT: ${ticker} has earnings in ${Math.ceil(diffDays)} days (${next.date})`);
            earningsAlerts.push({ ticker, days: Math.ceil(diffDays), date: next.date });
          }
        }
      } catch (e) {
        console.error(`Failed to fetch earnings for ${ticker}`, e);
      }
    }
    
    // In a real app, you would now loop through watchlist and notify user_ids
    // For now, we just log it.
  }

  return new Response(JSON.stringify({ 
    message: "Scoring and earnings check complete", 
    scored: results.length, 
    scoredDetails: results 
  }), {
    headers: { "Content-Type": "application/json" },
  });
});
