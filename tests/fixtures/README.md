# Fixtures

Trimmed copies of real, published project files from
`https://client.axept.io/projectconfigurations/brands/{projectId}.json`, captured on 2026-10-28.

Only the fields the engine reads are kept (project ID and name, `client.cookiesSettings`, `abTests`,
and for each configuration: identifier, name, title, language, country, subdivision, regulation,
isLive, published, partOfABTest, step names and layouts, page rules). Order is preserved: it decides
tie-breaks.

| File | Project | Why it's here |
|---|---|---|
| `mackage.json` | `691245e5b48e4a03c7b9c5c5` | Geolocation on, fallback set, single- and multi-country configs (the Ontario case) |
| `quilicot.json` | `683f03ffa5e569f3bae4483d` | Geolocation off, legacy `"QC"` subdivision, a page rule |
| `axeptio.json` | `624d5e22e4776e1f019014e2` | Geolocation off, 11 configs, three that can never win |

To refresh one, fetch the project file from a browser (the CDN allows any origin), keep the same
fields, and update the expectations in `tests/` if the project changed on purpose.
