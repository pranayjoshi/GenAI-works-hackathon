# Judge Q&A: the 12 hardest questions

All results are from local Nemotron 3 Nano 4B through Ollama.

**1. Does it predict which post wins?**
No. On 50 held-out Upworthy tests the crowd scored 22.5/50 (45.0%, CI 32.1 to 58.7). Single prompts scored 48% and 50%. All are consistent with chance. That is why the product abstains and recommends a spend decision.

**2. So why should anyone use it?**
It answers a question a prompt can't: can a paid test settle this at all? It also shows who reacted and why, what people kept private, and drafts version C. We have not shown it improves real outcomes.

**3. Your agents share one model. Aren't they all alike?**
Yes, more alike than real people are. Persona spread comes from Census, Pew and priors, not the model. Two seeds must agree, and when they don't it says "too close to call". The single-prompt baseline measures what the crowd adds. On this model, nothing measurable.

**4. The backtest is news headlines, not small-business posts.**
Correct. Upworthy 2013-2015 headlines are the only public set of real A/B tests we found with enough volume. It's a weak proxy, and we say so.

**5. Was the backtest tuned?**
Ranks 1 to 20 were a dev slice and never scored. The scored slice was ranks 21 to 70 by md5 of test id. One run, one seed, 40 people, 4 rounds.

**6. The competitor event: did it cause the gap?**
We can't say. A and B were tied before it and A was ahead after it. The gap is not significant, and an interrupted earlier attempt split differently. There is no run without the event.

**7. Is the 2.9-point gap real?**
It is inside a ±5.5-point interval, and neither seed was significant on a paired test. We report no measurable difference.

**8. Where do the audience numbers come from, and are they right?**
ACS 2024 5-year rows times Pew national Instagram use by age and gender. The 27,006 figure is an estimate: ACS adults in 78704 times national rates. It is not a count of local users.

**9. Did you really use Zetaris, Nightshift and hosted Nemotron?**
Not in these results. Everything ran locally. The Zetaris client follows the published API and passes a contract test against a fake server, but has not hit a live instance. Nightshift and hosted Nemotron are wired and switch on with a token or key (docs/SPONSOR_SETUP.md). Every query logs which engine answered.

**10. Is the customer data real?**
No. The demo customer CSV is synthetic and labelled. Users can upload their own. Census, Pew and Upworthy data are real and public (Upworthy CC BY 4.0).

**11. Does the guard just hide model errors?**
It fired on 731 of 4,146 decisions (17.6%), which is a lot, and we report it. It forces a positive action with a negative feeling to scroll-past, and strips invented prices or "seen it before" reasons. 0.9% of outputs needed a repair or default. The guard makes outputs coherent. It does not make them accurate.

**12. Is the decision rule just a power calculation? And is it a stereotype machine?**
Yes, the 3,828 per version is a standard two-proportion calculation (5% two-sided, 80% power), and that's the point: we wrap it in a simulated gap and a real audience size. On stereotyping: demographics come from Census and Pew, race and ethnicity are not sampled, and the voice writer never sees gender. Nothing is posted or spent without owner approval.
