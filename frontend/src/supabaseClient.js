import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || 'https://jjhbkkwwhnlccdripqoe.supabase.co',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqaGJra3d3aG5sY2NkcmlwcW9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2ODc3MjksImV4cCI6MjA5NDI2MzcyOX0.0ihU_dRewt9LM7pEm3K0lG822_tHYJeujCsXutDU6pQ'
);
