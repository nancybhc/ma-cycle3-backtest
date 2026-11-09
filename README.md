# 5破10推演量化策略 Dashboard

Static research dashboard for the A-share 5/10 projection quant strategy.

Signal: cycle-3 first appearance, projected next-day 5/10 cross, projected
5/10 gap expansion of at least 1 percentage point, an at-least-1% breakout
above the prior two daily highs, group breadth of at least 10%, and a composite
score of at least 0.275.

Exit: AI hardware is cleared at the close when the Shanghai Composite enters
MA5-to-MA10 bearish transition. A stock with more than 8% holding return sells
half on the first lower high and clears the remainder after the prescribed
lower-high sequence. A holding-group breadth below 7% also exits at the close.
A break below MA5 exits the remaining position, and a -8.5% stop is enforced
intraday from the next trading day. If MFE remains below 2% after the second
trading day, the position exits at that close.

Portfolio overlay: AI-hardware exposure follows the Shanghai Composite
MA5/MA10 stage using a 30%-90% sleeve. Every non-AI group is capped at 30%.
Existing holdings and new buys share one two-name cap per group.

The site is generated from local research output. It is a backtest visualization,
not investment advice or a live trading system.
