# Use a strict modular monolith

To keep the codebase maintainable, evolvable, and understandable without paying the coordination cost of distributed services, we chose a single deployable application organized into capability modules with hexagonal layers, composition-owned wiring, and explicit public gates. We accept broad import churn and stronger boundary guardrails in exchange for a clean mental model, local transactions, and the option to extract a service later only when independent scaling or release needs justify it.
