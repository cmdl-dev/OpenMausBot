import type { ModelCatalog, ProviderSnapshot } from "../contracts.ts";

/** A Router engine runs on the Router's key and bills the person's subscriptions there. */
export const ROUTER_SNAPSHOT: Pick<ProviderSnapshot, "account" | "billing"> = { account: { method: "api-key" }, billing: "subscription" };

/** A Router serves the providers' own models, so each keeps its catalog name and none is marked `custom`. */
export function routerModelCatalog(models: string[], official: ModelCatalog): ModelCatalog {
  const labels = new Map(official.options.map((option) => [option.id, option.label]));
  return {
    default: models.includes(official.default) ? official.default : models[0] ?? "",
    options: models.map((id) => ({ id, label: labels.get(id) ?? id })),
  };
}
