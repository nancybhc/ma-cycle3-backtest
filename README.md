# 5破10推演量化策略 Dashboard

Static research dashboard for the A-share 5/10 projection quant strategy.

Signal: cycle-3 first appearance, projected next-day 5/10 cross, and projected
5/10 gap expansion greater than 1.5 percentage points.

Exit: AI hardware is cleared at the close when the Shanghai Composite enters
MA5-to-MA10 bearish transition. A stock with positive holding return sells
half on the first lower high and clears the remainder after any later pair
of consecutive lower highs. A break below MA5 exits the remaining position,
and a -8% stop is enforced intraday from the next trading day. If MFE remains
below 2% after the second trading day and the close is below the entry price,
the position exits at that close.

Portfolio overlay: AI-hardware exposure follows the Shanghai Composite
MA5/MA10 stage using a 20%-80% sleeve. Every non-AI group is capped at 20%.
Existing holdings and new buys share one two-name cap per group.

The site is generated from local research output. It is a backtest visualization,
not investment advice or a live trading system.
