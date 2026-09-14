# Fixed candidate validation

The Profile probe accepts an explicit archive plus SHA-256, host npm project, Node executable and optional combination patch. It never rebuilds an explicit candidate or silently substitutes development dependencies for an invalid selected runtime. Child runtime facts and selected file hashes accompany the result; source attribution remains the integration owner's responsibility.

Strict NodeNext checks consume declarations from the inspected archive and its exact host peers without skipLibCheck. Archive inspection rejects missing or extra entries before copying content. This adds publication and integration evidence without changing plugin runtime inputs or the previously accepted 0.3.1 archive. Final Desktop and platform acceptance remain separate runs.

Explicit host selection requires a real project manifest and installation directory. The shared resolver reads package manifests through that installation's direct links, never an ancestor search. Logical and actual paths are recorded so pnpm store links remain usable without silently borrowing undeclared ancestor dependencies. Both entrypoints reject missing, empty and wrong-version hosts before launching the CLI or creating a declaration consumer.

Profile attempts retain native and tool settlements before assertions. Each activation has an exclusive evidence directory; repeated diagnostics cannot overwrite the first summary. Driver subprocess results remain separate from declared-task results. Unknown native fields remain unavailable rather than inferred from receipt outcomes. This repairs evidence retention, not the unexplained original vilN8t failure.
