# Country Leaderboard - Top GitHub Users By Country
Per user contribution leaderboard that actually works. Support it by starring the repo! ⭐

I found two other repos that do this, however one was completely broken and out of commission, another one was requiring users to have 600 followers on their GitHub profile to be considered for ranking, effectively dropping out most GitHub users and breaking whole purpose based on some arbitrary requirement.
Then I came to a revelation. Wait. This is GitHub. I can just create my own repo that does the same thing but correctly 😭


Also, this repo features a cleaner geography handling and avoids many common pitfalls. We can achieve this by reading both country and city in users "location" field. Then, instead of randomly assigning to corresponding country, we have to prioritize and distinguish country vs city. Countries take priority. Here are some of the complex examples and how they are resolved:

If your location says you are from "Atlanta, Georgia"
That means you are from United States. Real data shows this is a common geographical confusion that can be easily avoided.

If your location says you are from "Paris, Georgia"
That means you are from Georgia. Because Georgia as a country takes priority than just the city name outside above exception.

If your location says you are from "Georgia"
That means you are from country of Georgia, as country names are always interpreted as country names.

Non-major cities and typos are ignored.
Of course, if you got better suggestions, PR or issue is welcome! :D
