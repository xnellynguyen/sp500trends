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
    .is("resolved_at", null);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const now = new Date();
  const results = [];

  for (const p of predictions) {
    const createdAt = new Date(p.created_at);
    // Difference in calendar days
    const diffDays = (now.getTime() - createdAt.getTime()) / (1000 * 3600 * 24);
    
    // Simple logic: if 1d horizon and it's been >= 1 day, or 5d and >= 5 days
    const isDue = (p.horizon === '1d' && diffDays >= 1) || (p.horizon === '5d' && diffDays >= 5);
    
    if (isDue && p.base_price !== null) {
      try {
        // Finnhub quote endpoint returns current price
        const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${p.ticker}&token=${finnhubKey}`);
        const data = await res.json();
        const currentPrice = data.c;
        
        if (currentPrice) {
          const wentUp = currentPrice > p.base_price;
          const predictedUp = p.predicted_direction === "UP";
          const resolvedCorrectly = wentUp === predictedUp;

          // Resolve it in DB
          await supabase
            .from("predictions")
            .update({
              resolved_at: new Date().toISOString(),
              resolved_correctly: resolvedCorrectly
            })
            .eq("id", p.id);
            
          results.push({ id: p.id, ticker: p.ticker, resolvedCorrectly });
        }
      } catch (e) {
        console.error(`Failed to score ${p.ticker}`, e);
      }
    }
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
