# Test URLs

Manual verification links for the deployed renderer. Regenerate with
`npx tsx generate-test-urls.ts` after codec or generator changes — the
`i=` payloads below are version-bound (`v: 1`).

Builder (human landing page): https://settlemaker.com/
Image endpoint (URL contract): https://settlemaker.com/fmg

## Page behavior

| Check | URL | Expect |
|---|---|---|
| Builder page | https://settlemaker.com/ | Human landing page: form, live preview, copyable image links |
| Random demo | https://settlemaker.com/fmg | A different settlement per reload, filling the viewport |
| Broken payload | https://settlemaker.com/fmg?i=garbage | Parchment error card, reason `base64`/`inflate` — never a blank page |
| Unknown theme | https://settlemaker.com/fmg?name=X&pop=100&theme=nope | Error card listing the known theme presets |

## Flat parameter tier

| Check | URL |
|---|---|
| Coastal village, bearing-only water (organic synthetic shore) | https://settlemaker.com/fmg?name=Saltmere&pop=350&seed=3&port=1&plaza=1&oceanBearing=180&harbourSize=small |
| Walled town, classic theme | https://settlemaker.com/fmg?name=Aldford&pop=1400&seed=9&walls=1&plaza=1&temple=1&theme=classic |
| Same town, night theme | https://settlemaker.com/fmg?name=Aldford&pop=1400&seed=9&walls=1&plaza=1&temple=1&theme=night |
| Same town, ink theme | https://settlemaker.com/fmg?name=Aldford&pop=1400&seed=9&walls=1&plaza=1&temple=1&theme=ink |

Same name + seed across the theme variants must produce the identical
layout — only colors change.

## Scaling series (round 4: footprint and texture vs population)

Same name/seed/flags, population only varies. This is the canonical
demonstration that wall size, footprint count, and texture density all
grow with population instead of flattening out at a fixed patch count.
Expected patch counts at seed 9: 20k → 56, 30k → 84, 70k → 195,
200k → 220 (the cap — see known issues below).

Caution: the 200,000-population URL is expensive — measured 2923ms
generation, a 3832 KB SVG, and a 5739 KB GeoJSON — and generation is
synchronous on the main thread, so the page blocks (no spinner) while it
runs. Expect a multi-second freeze before it renders.

| pop | URL |
|---|---|
| 20,000 | https://settlemaker.com/fmg?name=Aldford&pop=20000&seed=9&walls=1&plaza=1&temple=1&theme=ink |
| 30,000 | https://settlemaker.com/fmg?name=Aldford&pop=30000&seed=9&walls=1&plaza=1&temple=1&theme=ink |
| 70,000 | https://settlemaker.com/fmg?name=Aldford&pop=70000&seed=9&walls=1&plaza=1&temple=1&theme=ink |
| 200,000 | https://settlemaker.com/fmg?name=Aldford&pop=200000&seed=9&walls=1&plaza=1&temple=1&theme=ink |

## Compressed `i=` payloads (the FMG channel)

**Grimhaven** — walled port on an organic vector coastline, 3 routes,
large harbour. The showcase link.

    https://settlemaker.com/fmg?i=hVbLbhw3EPyXOSsEyW72Q8dc_AE5GkYwtsb2IqtdYbVyEgv69xS1fAx8yUJYYZY9ZHV1VzVflx_LfbpbPr9cvi33r8tpfdyW--XD5fD4ff2xnZa75en89HJcr4fzCZEcY_3lcl3ur5eX7W75criuD9txuf-6Hp_x_Pd6PD73xafj-nPtD9ft8em49afn7-vp-u947cv6hI3mNpfz-vD7tl4Op2_Y7ePr8vn28OfDBpy5ovjrcHoA1Bq5vN39EkH_H1FmxNfz-bq8fQKM8_p8PR5O24ft_LhdLwD4EYf_g8wt4FQvJXtOyUq0uwWrvyWJse6NEAslskpJMUlBJLeIIj0iSZAc1Swp5ZRVpIfkHpI1qKqYO9YtK_dd2EYIDkqZo2QjZbdxEHMPIQ2sibGHixZx7xEDbIkhkSlpJmFOUfsmNNCyhJw8caFoUUx7wMDKKUjMbkk0F5E8sOaBlRWk5Mg1LHoiLj1kYGUOmgQUZHUT0hExsJIHK1acjBhf0rNJA2rJIXsxUxZl9Zx7xMAqOMWdkntlNltnPg6oYgE0xGgMIov2dOMAaikQR9eSDb-WcUgcQL0EsmSRCG-hU9oePnB6CmwJTVSMhIh6wIBp4CtT0lQ8KefYYNpA6RFFIfNU1Au-GgibKBEQVbMZCjOYsLhLU9Cg2RyF5F4yHRA1B8cTuzi5GbX1gVA5iBcudX8FEekWIJNHD-zOgnoymOKWowyEChXUvVkSGm-QsBMSBQJ5khVtB600jFNHSiELWhNUZVDQQU4VSQkmkUoGAq5U3gKmhoQCusAB6p1pbTxPBdXmL2hHQ_cWch8RsytBNNARpVyYNUs7ZAoIEQnag0YU_1JqfTsFlCVwKVCYFkBR6-qY-kkeHCS5ZUBI1sie4skOJiA8rVJHEzQmdtqxgAw8QuYuKQt1eU2UoCJxLjGyKaRrQ389gAMVND5BpIKCpt5S8wiUBkeIsMc0mdpZGrJLrmAS8mgYU4DYkJmWYkAoZYMPzrQNSWJL9vcC37jlHXHIygxBhdBDN2Ztz6vIu86rxTWvTnvetRoO-tQIBWhuMDlhCsYwVqQEv1ArN9YmraWqqFaeEkhDJ97WB0CB0NG-8OeI9MDsbX0g1BTqr4ZhYihbK-zsDHgNrE4ydBJhfbdV2WkwYgZV-UBnrSCzM6FAFMwVbVf5bRqfvf0uYZDqxBqR4237KQ6NocCuIaeMWWTt_Z26NEC-UB5sJsNEbuxPecKCKJHCijGBKLb5tNO3BU4YTLGOOW8NN_3BJBToCu9Wa-U2eKbBOAW8WxMAZMGQfF-fDuWKhka_Jww2VI5ux0-HsxzQOFmpKEVppZsGCQPEdDcMRsP4o2bB02BhoI6RKiRS346t9wa8wrCWulbwgZU3eqfHM85ncgiOMjA0W5hDgqtkC2jHkJTcpt1uytR1CAqKxBZo3lxaBO9OgNAd3sKCWdAddDfsGC2CWQjTqqYQ2wVhNy8LZjs8CdaI0Y5tmqp3M7fKvpYIXEDXcNkushGQQBSsFa2AcYc-aQHzlhJDJBiHOsYRKmo9YtqfACYuQgomqP7dAqZOHDPbYF7OqBZcUFvAvHJhqldzxsiFE6Mst27Z3YRyzRR0w2FrWaUHTLMheHA0eB9MA33R3WIKhtHwsG_DoGDc7Kz1zO5aBzpjPRypUvWDtj5rrgEDF5ZBud4g21jfXS6rP7eXHDNh97FfI97vpCHuPvntEy6339fL5_PL5Y_Dz3rFP66Xbxuuxcvztj3Uwr79Bw

**Highbury** — inland walled capital with citadel, 4 roads at the
cardinal diagonals.

    https://settlemaker.com/fmg?i=Rcw7DsIwEIThu0ztIi9TbEnFHRDFQpbE0saxHCcoRLk7pgiU_0jzbVhApcF9jh1og-dBQLi4rs_TCoMwhlk5udGDqlNRfJeYQE_WSQweLnErCkpxzvli1emIoPzmI5IMQeWoqWef1r_CITs_JY7cnoWj813Gro01ZW1NVVlTl_a257tIC2r2Dw

**Fenwick** — routeless hamlet (`roadBearings: []`): must render ZERO
external roads.

    https://settlemaker.com/fmg?i=RcwxEoIwEEbhu_x1CrFzSwsvwVisZMUMS5JJgowy3N3YhPIr3tvwBnUGjyWNoA2eZwHhJn51wwSDGOKiXFzwoMvp71RAT9YsBoMrbEWbV1bNTVH5y01F5qjSmF_sy-c4cayv45QC26twcn6sw_6-10LEgs7d_gM

## Known issues to NOT report twice (fidelity round 2-4 backlog)

- Settlement outlines are still quite circular.
- When no patch straddles the painted shoreline (mesh-dependent, e.g. some
  seeds in oceanBearing mode), harbour placement falls back to patch
  adjacency and the district can sit inland of the visible waterline; piers
  are rescued to the shore, warehouses are not.
- A thin single-patch gap can still show between the outermost building row
  and the wall on some seeds — the proportional trim leaves a small empty
  band inside walls (measured ≈10.7% of wall radius on the Salt Harbour
  reference fixture as of round 4, down from ≈16% at round 3 and ≈9%
  pre-curve; test ceiling 25%. Round 4 did not touch the trim policy, so
  this is a re-measurement, not a fix).
- Piers on obliquely-crossing shores can occasionally sit fully on land (they
  extend along the patch edge normal, not toward the water).
- Megacities beyond ~pop 79,000 (round 4): households (pop / 30) exceed the
  220-patch cap, so the footprint count and per-patch layout stop growing
  and the remaining population is absorbed by denser in-patch texture
  instead of more distinct footprints. Wall size keeps scaling with
  population; only the fine-grained building texture compresses past the
  boundary. The Aldford scaling series above brackets this — 20k and 30k
  sit below the boundary with distinct individual footprints, 70k is close
  to it, 200k is well past it and shows compressed texture.
