# ACUMEN vs Terra — Comparative Analysis
**Date:** 2026-05-07  
**Status:** For Revisit — Potential Collaboration Opportunity  
**Context:** Unsolicited MSc thesis outreach from researcher building anti-poaching intelligence system targeting Tsavo ecosystem.

---

## What is ACUMEN?

MSc thesis project focused on anti-poaching intelligence for Kenyan wildlife reserves.  
Builds and fuses two independent models:

1. **Acoustic Model** — Deep learning model trained to detect gunshots from audio recordings.  
   - Dataset: Katsis et al. (2022) — 749 labelled gunshots + 35,000 background sounds (Mendeley)  
   - Output: Confidence score (probability that a gunshot occurred at a location)

2. **Spatial Risk Model** — Risk mapping of Tsavo ecosystem using Google Earth Engine (GEE) satellite data.  
   - Variables: Vegetation density, distance to roads, distance to water sources, proximity to human settlements  
   - Output: Risk score per 1km² grid cell

3. **Bayesian Fusion** — Combines both scores: if a gunshot is detected AND the location is environmentally high-risk, the combined alert is significantly stronger than either signal alone.  
   - Claimed novelty: No published research has combined acoustic + spatial signals this way.

**Primary Data Gap:** Georeferenced poaching incident records (GPS coordinates) for Kenya/Tsavo.  
Ideal sources: KWS records or Gitahi et al. (2014) dataset — both currently inaccessible.  
Working around this with the GEE environmental approach.

---

## Key Differences vs Terra

| Dimension | ACUMEN | Terra |
|---|---|---|
| **Data Input** | Passive — acoustic sensors + satellite data | Active — ranger and community field reports |
| **AI Approach** | Deep learning (CNN/RNN for audio) + Bayesian fusion | Heuristic 8-point scoring matrix (ICE) — ML layer is roadmap item |
| **Scope** | Risk model / research output | Full operational platform (ingest → score → analyse → deploy) |
| **User Interface** | None described for rangers/commanders | Designed specifically for non-technical frontline users |
| **Community Layer** | Not present | Community early-warning alert system |
| **Cross-Property** | Single study area (Tsavo) | Multi-property networked platform |
| **Acoustic Detection** | Yes — core component | No acoustic component currently |
| **Operational Deployment** | Academic research | Commercial product for NGO deployment |

---

## Areas of Genuine Overlap

- Both operate in the Tsavo ecosystem (East Africa)
- Both produce confidence/risk scores as core outputs
- Both aim to reduce poaching response latency
- Both would benefit from georeferenced incident-level data

---

## Collaboration Opportunity — HIGH PRIORITY TO REVISIT

**What ACUMEN can offer Terra:**  
ACUMEN's GEE-derived environmental risk surface (vegetation density, terrain, proximity to roads/water) is precisely the **spatial prior layer that Terra's ICE currently lacks.** If ACUMEN's grid-cell risk scores could be ingested into Terra as a weighted environmental variable, the ICE scoring matrix would become significantly more accurate — flagging reports from known high-risk terrain more aggressively than identical reports from low-risk zones. This would meaningfully upgrade Terra's predictive capability without requiring a full independent GEE pipeline rebuild.

**What Terra can offer ACUMEN:**  
Terra's ranger-submitted, georeferenced sighting and incident reports are **exactly the labeled incident-level data ACUMEN needs** to ground-truth its spatial risk surface. This is ACUMEN's stated primary data gap.

**The exchange is clean:**  
> ACUMEN provides environmental risk scores per grid cell.  
> Terra provides field-verified incident coordinates.  
> Both systems become stronger.

---

## Suggested Next Steps (When Revisiting)

- [ ] Request ACUMEN's GEE pipeline documentation — assess feasibility of ingesting risk scores into PostGIS as a spatial layer
- [ ] Clarify data ownership and sharing terms before offering access to Terra's incident records
- [ ] Assess whether ACUMEN's acoustic model could eventually be integrated as a passive input stream into Terra's ICE (gunshot confidence score as a 9th scoring criterion)
- [ ] Determine thesis timeline — MSc submission deadline may create urgency on their side
- [ ] Consider co-authorship or acknowledgement in respective publications if data exchange proceeds

---

## Contact Context
Inbound outreach. Researcher is actively seeking collaboration.  
They reached out first — motivation is genuine data access need, not competitive intelligence.

---

*Filed: 2026-05-07 | Folder: /docs | Review Priority: Medium-High*
