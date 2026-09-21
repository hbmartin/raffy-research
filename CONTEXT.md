# Raffy Research

Raffy Research is an analyst-operated market-intelligence quality pipeline for an early-stage B2B SaaS company. It turns captured market material into traceable Weekly Reports while keeping acquisition quality distinct from synthesis quality.

## Language

### Participants

**Analyst**:
A person who reviews Weekly Reports, traces claims to Source Records, applies Source Relevance Labels, and scores report quality.
_Avoid_: Reviewer, Operator

**CEO**:
The intended audience for a Weekly Report. A CEO may read a report, but is not synonymous with the Analyst who operates the quality loop.

### Monitoring

**Workspace**:
The monitored environment for one company, containing its company context, watch configuration, captured material, Weekly Reports, and quality judgments.
_Avoid_: Account, Tenant, Company

**Keyword**:
A plain phrase that steers which market material is sought and helps establish its relevance to a Workspace.
_Avoid_: Search Query, Tag

**Competitor**:
A company whose market activity matters to a Workspace. Its state records whether it is watched, suggested for watching, or ignored.
_Avoid_: Rival

**Suggested Competitor**:
A candidate Competitor surfaced by a Weekly Report and supported by Evidence Items. It is not part of the active watchlist until accepted.
_Avoid_: Competitor

**Social Account**:
A public profile selected for monitoring within a Workspace.
_Avoid_: User Account

**Provider**:
An external or internal service through which market material is acquired. A Provider is a capture channel, not the original Source.
_Avoid_: Source, Data Source

**Internal Note Source**:
A private team location intentionally selected as eligible market context for a Workspace. Material captured from it becomes a Source like externally captured material.
_Avoid_: Provider

### Evidence

**Ingestion**:
The acquisition of material through Providers and its conversion into Source Records while preserving where it came from.
_Avoid_: Synthesis

**Source**:
The original item being referenced, such as a post, discussion, webpage, report, note, or change event. It exists independently of the Provider that captured it.
_Avoid_: Provider, Source Record, Evidence Item

**Source Record**:
Raffy Research's durable capture of a Source and its provenance. Multiple Source Records may represent the same or closely related Source.
_Avoid_: Source, Evidence Item

**Search Result**:
An item returned by a search performed for a Keyword. It remains distinct from a Source Record unless the underlying item is captured.
_Avoid_: Source Record

**Source Summary**:
A concise derived reading of a Source Record that may identify candidate evidence. It supports synthesis but is neither an Evidence Item nor a citation.
_Avoid_: Evidence Item, Observation

**Signal**:
An intentionally loose name for any potentially meaningful occurrence or candidate insight found in source material. It is not a formal classification or taxonomy.
_Avoid_: Evidence Item, Observation

**Evidence Item**:
A report-ready excerpt or summary that supports an Observation and is traceable to one or more Source Records.
_Avoid_: Source, Source Record, Signal

**Observation**:
An evidence-backed statement in a Weekly Report about what appears to be happening or changing. It surfaces interpretation without prescribing an action.
_Avoid_: Recommendation, Advice

**Source Relevance Label**:
A Keep or Junk judgment by an Analyst about a Source Record; a record without a label is unreviewed. Junk Source Records are excluded from future synthesis.
_Avoid_: Report Rubric Score, Feedback Event

### Reports

**Coverage Period**:
A completed Monday-through-Sunday week in the Workspace's timezone to which a Weekly Report and its eligible Source Records belong.
_Avoid_: Generation Week

**Weekly Report**:
A frozen synthesis of one Workspace's market evidence for a Coverage Period, written for its CEO and composed of traceable observations and supporting material. Multiple published Weekly Reports may cover the same period, but each remains unchanged.
_Avoid_: Digest, Report Artifact

**Contradiction**:
An evidence-backed report item that identifies tension between an internal assumption and an external market signal.
_Avoid_: Disagreement

**Topic Cluster**:
A report grouping of related Observations and Evidence Items around an emergent market theme.
_Avoid_: Category

**Market Question**:
An actual question observed in market source material and supported by Evidence Items. It is not a question invented by Raffy Research for the CEO to consider.
_Avoid_: Decision Prompt, Research Question

**Possible Lead**:
A person or company appearing in source material whose question, complaint, intent, or pain may be commercially relevant to the Workspace. It is an observed candidate, not an enriched or qualified prospect.
_Avoid_: Qualified Lead, Prospect

**Social / Product Feedback**:
An evidence-backed Weekly Report item describing observed reactions to products, competitors, categories, or market pain points. It represents captured market material, not feedback about Raffy Research.
_Avoid_: User Feedback

**Source Library**:
The selected Cited Sources and Relevant-but-unused Sources associated with a Weekly Report. It is not the complete archive of Source Records for the Workspace or Coverage Period.
_Avoid_: Source Archive

**Cited Source**:
A Source Record selected for a Weekly Report and used to support its report content.
_Avoid_: Relevant-but-unused Source

**Relevant-but-unused Source**:
A Source Record selected for a Weekly Report's Source Library but not used to support its report content.
_Avoid_: Cited Source

**Sparse Report**:
A successfully published Weekly Report with little or no new evidence in one or more sections. Sparsity describes the available evidence, not a generation failure.
_Avoid_: Failed Report

**Failed Report**:
A Weekly Report attempt that did not produce a valid published report. It is distinct from a successfully published Sparse Report.
_Avoid_: Sparse Report

### Quality

**Report Rubric Score**:
An Analyst's quality judgment for one Weekly Report across Relevance, Accuracy, and Novelty. It measures synthesis quality separately from Source Relevance Labels and machine Report Evaluations.
_Avoid_: Source Relevance Label, Report Evaluation, Report Rating, Feedback Event

**Report Evaluation**:
A machine-produced judgment of a Weekly Report against Source Records for claim support, coverage, and noise. It is distinct from an Analyst's Report Rubric Score.
_Avoid_: Report Rubric Score

**Relevance**:
The degree to which a Weekly Report covers what matters to its Workspace during the Coverage Period.
_Avoid_: Source Relevance Label

**Accuracy**:
The degree to which a Weekly Report's claims remain faithful to its underlying Source Records.
_Avoid_: Confidence

**Novelty**:
The degree to which a Weekly Report conveys meaningful information the Analyst did not already know.
_Avoid_: Newness Label
