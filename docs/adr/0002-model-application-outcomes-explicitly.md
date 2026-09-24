# Model application outcomes explicitly

Because internal application flow should not use exceptions as control flow, we chose tagged Boxed `Result.Ok` variants for expected business branches and `Result.Error(AppError)` for failures, with exhaustive mapping at boundaries. Exceptions and `try/catch` are reserved for boundaries whose contracts can throw, including external libraries, persistence and owned transactions, startup, and exception-driven protocols, and must be translated before re-entering app-owned flow.
