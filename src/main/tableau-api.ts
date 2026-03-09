import type { TableauFilters } from '../shared/types';

interface TableauAuthResponse {
  credentials: {
    token: string;
    site: {
      id: string;
    };
    user: {
      id: string;
    };
  };
}

interface TableauSyncResult {
  success: boolean;
  csvPath?: string;
  error?: string;
}

/**
 * Authenticate with Tableau Cloud using Personal Access Token
 */
async function authenticateWithTableau(
  siteName: string,
  patName: string,
  patSecret: string,
): Promise<{ token: string; siteId: string } | null> {
  const serverUrl = 'https://prod-useast-a.online.tableau.com';

  try {
    const response = await fetch(`${serverUrl}/api/3.28/auth/signin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        credentials: {
          personalAccessTokenName: patName,
          personalAccessTokenSecret: patSecret,
          site: {
            contentUrl: siteName,
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[tableau-api] Authentication failed:', response.status, errorText);
      return null;
    }

    const data: TableauAuthResponse = await response.json();
    return {
      token: data.credentials.token,
      siteId: data.credentials.site.id,
    };
  } catch (err) {
    console.error('[tableau-api] Authentication error:', err);
    return null;
  }
}

/**
 * List all views on the site to find the correct view ID
 */
async function listAllViews(token: string, siteId: string): Promise<void> {
  const serverUrl = 'https://prod-useast-a.online.tableau.com';

  try {
    const response = await fetch(`${serverUrl}/api/3.28/sites/${siteId}/views?pageSize=1000`, {
      method: 'GET',
      headers: {
        'X-Tableau-Auth': token,
        'Accept': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      console.log('[tableau-api] 📋 Available views on your site:');
      const views = data.views?.view || [];

      // Filter to show relevant views (containing keywords)
      const relevantViews = views.filter((v: any) =>
        v.name.toLowerCase().includes('pipeline') ||
        v.name.toLowerCase().includes('opportunit') ||
        v.name.toLowerCase().includes('open') ||
        v.contentUrl.toLowerCase().includes('gtm') ||
        v.contentUrl.toLowerCase().includes('intelligence') ||
        v.contentUrl.toLowerCase().includes('product')
      );

      if (relevantViews.length > 0) {
        console.log('[tableau-api] 🎯 Relevant views found:');
        for (const view of relevantViews) {
          console.log(`  - Name: "${view.name}"`);
          console.log(`    ContentUrl: "${view.contentUrl}"`);
          console.log('');
        }
      }

      console.log(`[tableau-api] Total views: ${views.length}, Relevant: ${relevantViews.length}`);
    } else {
      console.error('[tableau-api] Failed to list views:', response.status);
      const errorText = await response.text();
      console.error('[tableau-api] Error:', errorText);
    }
  } catch (err) {
    console.error('[tableau-api] Error listing views:', err);
  }
}

/**
 * Build filter parameters for Tableau REST API
 */
function buildFilterParams(filters: TableauFilters): string {
  const params: string[] = [];

  // Map filter keys to Tableau field names (adjust these based on actual Tableau field names)
  const fieldMap: Record<keyof TableauFilters, string> = {
    product_group: 'Product Group',
    segments: 'Segment',
    close_quarter: 'Close Quarter',
    commissionable: 'Commissionable',
    ai_ae: 'AI AE',
    svp_leader: 'SVP Leader',
    svp_minus_1: 'SVP Minus 1',
    vp_team: 'VP Team',
  };

  for (const [key, fieldName] of Object.entries(fieldMap)) {
    const values = filters[key as keyof TableauFilters];
    if (values && values.length > 0) {
      for (const value of values) {
        if (value) {
          params.push(`vf_${encodeURIComponent(fieldName)}=${encodeURIComponent(value)}`);
        }
      }
    }
  }

  return params.length > 0 ? '?' + params.join('&') : '';
}

/**
 * Check if viewId is a custom view LUID (UUID format) or standard view path
 */
function isCustomViewLuid(viewId: string): boolean {
  // Custom view LUIDs are UUIDs: 8-4-4-4-12 hex characters with dashes
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidPattern.test(viewId);
}

/**
 * Download CSV data from a Tableau view or custom view
 */
async function downloadTableauView(
  token: string,
  siteId: string,
  viewId: string,
  filters: TableauFilters,
): Promise<string | null> {
  const serverUrl = 'https://prod-useast-a.online.tableau.com';
  const filterParams = buildFilterParams(filters);

  // Note: Custom views (UUIDs) don't support CSV export via REST API (returns 406)
  // We must use the base view path with filters instead
  const isCustomView = isCustomViewLuid(viewId);

  if (isCustomView) {
    console.error('[tableau-api] ❌ Custom view UUID detected:', viewId);
    console.error('[tableau-api] Custom views do not support CSV export via REST API (returns HTTP 406).');
    console.error('[tableau-api] Solution: Use the base view path instead and configure filters in Settings.');
    console.error('[tableau-api] Example: "GTMIProductIntelligence_17425742277560/OpenPipelineDash"');
    return null;
  }

  // The crosstab endpoint requires /excel at the end
  // But we can try to get CSV via Accept header
  const crosstabEndpoint = `${serverUrl}/api/3.28/sites/${siteId}/views/${viewId}/crosstab/excel${filterParams}`;

  console.log('[tableau-api] Using crosstab endpoint:', crosstabEndpoint);

  try {
    // Try requesting CSV format via Accept header
    // (Tableau might return CSV if we ask for it, even though URL says /excel)
    const response = await fetch(crosstabEndpoint, {
      method: 'GET',
      headers: {
        'X-Tableau-Auth': token,
        'Accept': 'text/csv',
      },
    });

    console.log('[tableau-api] Response status:', response.status);
    console.log('[tableau-api] Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[tableau-api] Download failed:', response.status);
      console.error('[tableau-api] Error body:', errorText);
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    console.log('[tableau-api] Content-Type:', contentType);

    // Check if we got CSV or Excel
    if (contentType.includes('csv') || contentType.includes('text')) {
      const csvData = await response.text();
      console.log('[tableau-api] Downloaded CSV length:', csvData.length);
      console.log('[tableau-api] First 200 chars:', csvData.substring(0, 200));
      return csvData;
    } else if (contentType.includes('excel') || contentType.includes('spreadsheet')) {
      console.error('[tableau-api] ❌ Received Excel format, not CSV');
      console.error('[tableau-api] The /crosstab/excel endpoint returns Excel files only.');
      console.error('[tableau-api] CSV export for worksheet data is not supported by Tableau REST API.');
      return null;
    } else {
      // Try as text anyway
      const data = await response.text();
      console.log('[tableau-api] Unknown content type, trying as text. Length:', data.length);
      console.log('[tableau-api] First 200 chars:', data.substring(0, 200));
      return data;
    }
  } catch (err) {
    console.error('[tableau-api] Download error:', err);
    return null;
  }
}

/**
 * Clean up blank AI AE values by matching Manager Name
 * This handles the data quality issue where AI AE is sometimes blank
 */
function cleanupBlankAiAe(csvData: string): string {
  const lines = csvData.split('\n');
  if (lines.length === 0) return csvData;

  const header = lines[0];
  const rows = lines.slice(1);

  // Find column indexes
  const columns = header.split(',').map((col) => col.trim().replace(/^"|"$/g, ''));
  const aiAeIndex = columns.findIndex((col) => col.toLowerCase().includes('ai ae') || col === 'AI AE');
  const managerIndex = columns.findIndex((col) =>
    col.toLowerCase().includes('manager') || col === 'Manager Name'
  );

  if (aiAeIndex === -1 || managerIndex === -1) {
    console.warn('[tableau-api] Could not find AI AE or Manager columns for cleanup');
    return csvData;
  }

  // Build a map of Manager Name -> AI AE (from rows where AI AE is not blank)
  const managerToAiAe = new Map<string, string>();

  for (const row of rows) {
    if (!row.trim()) continue;

    const cells = row.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
    const manager = cells[managerIndex] || '';
    const aiAe = cells[aiAeIndex] || '';

    if (manager && aiAe && !managerToAiAe.has(manager)) {
      managerToAiAe.set(manager, aiAe);
    }
  }

  // Fix rows where AI AE is blank
  const cleanedRows = rows.map((row) => {
    if (!row.trim()) return row;

    const cells = row.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
    const manager = cells[managerIndex] || '';
    const aiAe = cells[aiAeIndex] || '';

    // If AI AE is blank but we have a mapping for this manager, fill it in
    if (!aiAe && manager && managerToAiAe.has(manager)) {
      cells[aiAeIndex] = managerToAiAe.get(manager)!;
      return cells.map((cell) => `"${cell}"`).join(',');
    }

    return row;
  });

  return [header, ...cleanedRows].join('\n');
}

/**
 * Sign out from Tableau (cleanup)
 */
async function signOutFromTableau(token: string): Promise<void> {
  const serverUrl = 'https://prod-useast-a.online.tableau.com';

  try {
    await fetch(`${serverUrl}/api/3.28/auth/signout`, {
      method: 'POST',
      headers: {
        'X-Tableau-Auth': token,
      },
    });
  } catch (err) {
    console.error('[tableau-api] Sign out error:', err);
  }
}

/**
 * Main function to sync data from Tableau
 */
export async function syncFromTableau(
  siteName: string,
  patName: string,
  patSecret: string,
  viewId: string,
  filters: TableauFilters,
): Promise<TableauSyncResult> {
  console.log('[tableau-api] Starting Tableau sync...');
  console.log('[tableau-api] Site:', siteName, 'View:', viewId);

  // Step 1: Authenticate
  const auth = await authenticateWithTableau(siteName, patName, patSecret);
  if (!auth) {
    return { success: false, error: 'Failed to authenticate with Tableau. Check your PAT credentials.' };
  }

  console.log('[tableau-api] Authenticated successfully. Site ID:', auth.siteId);

  try {
    // Step 2: Download CSV data
    const csvData = await downloadTableauView(auth.token, auth.siteId, viewId, filters);
    if (!csvData) {
      // Check if it was a custom view issue
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidPattern.test(viewId)) {
        return {
          success: false,
          error: 'Custom views (UUIDs) do not support CSV export. Please use the base view path (e.g., "WorkbookName/ViewName") and configure filters in Settings instead.'
        };
      }
      return { success: false, error: 'Failed to download data from Tableau view. Check the terminal console for detailed error logs.' };
    }

    console.log('[tableau-api] Downloaded CSV data, length:', csvData.length);

    // Step 3: Clean up blank AI AE values
    const cleanedData = cleanupBlankAiAe(csvData);
    console.log('[tableau-api] Data cleaned up');

    // Step 4: Save to temporary file
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');

    const tmpDir = os.tmpdir();
    const csvPath = path.join(tmpDir, `tableau-sync-${Date.now()}.csv`);

    fs.writeFileSync(csvPath, cleanedData, 'utf-8');
    console.log('[tableau-api] Saved to:', csvPath);

    return { success: true, csvPath };
  } finally {
    // Step 5: Sign out
    await signOutFromTableau(auth.token);
    console.log('[tableau-api] Signed out from Tableau');
  }
}
