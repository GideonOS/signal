"use client";

import { INTEGRATIONS } from "@/lib/integrations";
import { useIntegrationsStatus } from "@/hooks/use-integrations-status";
import { MissingKeyBanner } from "@/components/missing-key-banner";

/**
 * Renders one `<MissingKeyBanner />` per missing required integration.
 * Mounted at the top of the dashboard shell so it's the first thing a user
 * sees if the app isn't fully configured. Optional integrations are not
 * banner-worthy — those surface in the /settings integrations panel.
 *
 * Renders nothing while the status fetch is in flight or if it fails, so
 * the dashboard never shows a misleading "everything is broken" banner
 * during a transient hiccup.
 */
export function MissingKeyBannerStack() {
  const { statuses } = useIntegrationsStatus();
  if (!statuses) return null;

  const missingRequired = INTEGRATIONS.filter((integration) => {
    if (integration.severity !== "required") return false;
    const status = statuses.find((s) => s.id === integration.id);
    return status && !status.configured;
  });

  if (missingRequired.length === 0) return null;

  return (
    <>
      {missingRequired.map((integration) => {
        const status = statuses.find((s) => s.id === integration.id);
        return (
          <MissingKeyBanner
            key={integration.id}
            integration={integration}
            missingEnvVars={status?.missingEnvVars ?? integration.envVars}
          />
        );
      })}
    </>
  );
}
