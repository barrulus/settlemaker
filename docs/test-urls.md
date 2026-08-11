# Test URLs

Manual verification links for the deployed renderer. Regenerate with
`npx tsx scripts/generate-test-urls.ts` after codec or generator changes — the
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
| Small core, big town (coreCapacity knob) | https://settlemaker.com/fmg?name=Aldford&pop=20000&seed=9&walls=1&plaza=1&coreCapacity=4000 |

Same name + seed across the theme variants must produce the identical
layout — only colors change.

## Scaling series (footprint, texture, and the walled-core cap)

Same name/seed/flags, population only varies. Walls enclose a core capped
at `coreCapacity` people (default 10 000): below the cap most people live
inside a compact, densely row-housed circuit; above it the walled old town
stops growing and the overflow renders as unwalled faubourgs and roadside
sprawl around it. Generation is fast across the whole range (measured at
seed 9: ~0.1 s at pop 20 000 to ~0.5 s and a ~530 KB SVG at pop 200 000).

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

**Thornbury** — route-character showcase: through flat road N (grows a
faubourg), foot trail SE (stays bare), ridge road SW (little growth).
Extramural development must visibly favour the north.

    https://settlemaker.com/fmg?i=jZDBTgMxDET_xeettKXlkiPfwA2hyiXeJCJNIsdbVFb77zii3aVw4fgm4_HEE5zBbDs4juzATJDwRGDg2WdOql2gg5LLGFFCTmD2fd83hQXMgLFSB29B0FJc-ANjrGCER4US8RNvIHQqkRZj9ZjksuZg0aQ1hzPaJ0IOyWncywTHbzhY0qbbvjlGoUOw2ve9uTZtRAsrNO1KTm3lilVZvArO30oxxUCDvg_6R5i733t294uqp-KJbd0UFL8uG3KWH8uEMegV_sQ97B_v4nxw_n-1l54crCOYX2e9IJFO7OYv

**Riverwatch** — river-valley pull: growth clusters on the road that
follows the river through the valley, not the one climbing away.

    https://settlemaker.com/fmg?i=dY_dasMwDIXfRdcpZC2F4cs9Qm_HKGqixAbVNraS0IW8e5WGJGzQy--g86MRejAfBdy61IIZweOdwMDF9ZQGlMpCATHEjlFc8GCOx7KclSRgGuRMBVROsCbeeEDmDEZSpxAZf3EFoXtkWilb9PLYYzBq0B6TAtZfhMn5VtO-R7gtcK1Jl36W80UndHW17u2R6TA7dG6relRtxqwsVoXWrrWJ2FGzeJgeetAE5jDk18_L1VT8qzuVf_usY37XtxVgrsgLTD-TPkukvvP0BA

**Kingsmoor** — `coreCapacity: 5000` against 60 000 people: a compact
walled old town (citadel inside) surrounded by much larger unwalled sprawl
along the two real roads; the trail approach stays quiet.

    https://settlemaker.com/fmg?i=bZBBb8IwDIX_i889DAQcchzH3biiCZnWbSO5deSkrVjV_z53KAjBcnv2y5f3MsMIblPAddAG3Aw9dgQOvnzfxE5EoYAgYWBMXnpwhw8760gTuBo5UgGlT1gRg0s6mJyQOWYRGH8wi0RdYMoqttinW1YlBsM8IKUoHTGgsc2y_3tUBatPQl2jgTvPcL2LS0UW3QyNyhAs_GqMFjy1NmjazFRiT7Xta2sDS_EC2Oz-QTzujNaKbjaphVmmePIj6Z38Rtrun0hJ0dt_LN-LVSaqbL38Ag

**Saltmarsh** — the most comprehensive single payload: walled port, vector
coastline, large harbour, and rich route character on all three approaches.
Wall must close along the water's edge with the harbour gate opening onto
piers that reach the water.

    https://settlemaker.com/fmg?i=jVfBctw2DP0XnR0OCRIg4GMvvTfHTCajxLK9U3l3R7tOmmb8731ckaLcXro3iRD5CLz3gP01fB_uw93w9XV5Gu5_DcfxZRruh4_jfH0Zl8vzcDecT-fXebweTsfhnjx-5dVyHe6vy-t0N3w7XMeHaR7uH8f5gucf4zxf2uJ5Hv8e28N1ejnPU3u6PI_H68_ts2_jGRv1bZ7H5evpdfl4-LvgmcflaQKWb6fxcp0Px-n36fQyXRd8_-nTr-Ev3EGcT158DEFzTBblbsDqhyDev93dQoicapSYOFDgaJJqCMsWoi6oJiEWNQvBt12YdiFGKQXK7INaylxDkraQlLBL8Fkk5syq2iJSi2BzKgQoZESauSFJG1jxLpiIxixmmi3WiLhhleRiZKFyQ1OlFrAhzeRYTCkqK1Ij7S60ARV22DoJjs3IW9gi9kBxBYtBIvCGDSh1oEiZGJIuyTwy3_YIG9AcADQZUhiIKVkLoF0AYfOSCMPb0O7qN6AqLgSk2iuCvFHLqN-AmrqcLLPkIMK8ld9vQE1cFsrmQ0I5Y6h72IbTUBQKGRgjkFCoGbUNZ_DRxYRcIOOqXtoW2nGak4D3CQUDjBxqwAYzZ4ckJokhR1JtNdENZRaXIplQRBiuV3fIvezZqWUNCAgBhanrG0hWJ-Yj7phTishnLZm8q7oYswZTgKn1kI7RO08iOYJswQduAb3k5IxzkRp7SMEqBt5TkzhkzpBAYUXNUxcRArA_1JpVQLsKcacgdckX5iqHJMFawIYxQu5BAd6wThnsqxEbyBhRTajDSq4TarEGdP0UO8g4gxKki3pz3aILKCQHDwCnE8gQPY5aI7qAKDkoNGVchlEOrV7Q9RODAwZGoTyqQhZahN9FxEgRtSYzxuFNyBvQRC7hFFZwz2IU3jTYSg79MKdiaahZ1NhI1TaIzhQS9QCK73NuueoHQGqWCUBQ10QNpONc9JQ8sobteYIRtm8ySKKebyblcbPbJ31Lj8QYsTHunblyaEMUzcFbE3sugkOl18zuroTqiYcLK-qTmHIN6BSLrmA1nF3MPq3rO1vKDkpHMhgUTs1he2EUDISO0AnAnmjV6HtljZ3h7viSA4Mca846N8xDA6BnDhkkAtvX9W4mxdO8Jvgg8oqImp9tPTq0IeQGBgWHTWvNOsEVxBHNOYDEnLmaUVdITvA7OGFIRey57t8Vhu-RHZgum4H-qwK7QrFcgKE9IEVg9nq9LvFcXARoUzGhcv91vcMzF9E4WNlHIquk7R5jsAiCvGFQReKypqe7lBLOh6bwBVyAqyy6y-H8YtFJDRRDC4yVP9s6nBiURkMBM6HQ9fzus-CPoefARz1yq9WIu1Gn4IC9tKVUeN_Ghe71CFAmdF784C41_71ZxOSYPcoLheAYXhO8azdkEB2oi_0tMWJyjXinEVg0BS39xCqFdl0PcwTGCFSQSsuD_laQu84ZFS0eFhYpw4-lGumu9-IakstUVEgKJw1NZ_t7RtQ3WsHZxojdBEDoN6ChwGcFKY9WA7oHwkcjskxwSUG-41rL3SCCkckn2A6KhX1wlxrQrRhGi-3R1DjBULTSdTcOFRQCd8KuaFxE9R5dL0lACFAxwgR9KWoN2GCyOCuzFLKIvmd5ZdRusCsTV4anlXJjopIWIDvOwQtxpqHDKxk3S9pAchmObx9hlrDdT_8dcZtLnd_96O3z57thOY0Pv03jcjg-YYjGaPt1ffjyMD3d7K2EvF6nL4cHjMW3cfhD-Qaz8Z-HY3lXn54Qdq6PFzxfn_Hi6blN38s0H6ZHrD9itB8KuvcHlU62O-hwnMfjw_87adv6O_4JTD_x5vE0z6cflz8O36dlBfCfA9H_3t9sPjw-fjiP1-d-3uPpdN2dd13Gw_zuwOXwgH8Jb5_f8O9imvBJfvsH

## Known issues to NOT report twice (deferred-defects ledger)

- Park and Cathedral wards are currently very rare at city scale (the ward
  deck is sized against more patches than are actually dealt — tracked as a
  known defect with a pinned test, `tests/known-defects.test.ts`).
- Tiny hamlets (pop 40-100) render thin (well under their building target)
  on some seeds — thinning, not emptiness.
