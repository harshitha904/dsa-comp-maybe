# Lives Group UI integration (review branch)

This branch starts from tancysam/dsa-comp-maybe main
`0128718dcf1889bd5d0bb1b3b4a83c959548bb54` and incorporates the previously
production-deployed Lives Group ticket workspace from
harshitha904/dsa-comp-maybe commit
`f6339dc2d648d3bb5f5c70096596402f670e9625`.

Provenance was verified against Vercel deployment
`dpl_7267WJjfTuJcUfSMT1uNY9p98GxJ`. The primary build still produces the same
`main-C6VcFsiZ.js` and `main-C5JHtK3a.css` assets as that deployment. Upstream's
subsequent `52cbecf` changes only release documentation and is not needed for this
integration.

The Lives Group ticket interface is the primary entry. The latest main workspace,
including its theme updates and fixed graph, remains at `/legacy.html`. The
Relationship graph navigation embeds `/legacy.html#graph`. Missing or unknown
customer ownership is shown as Unassigned rather than hiding persisted records.

Conflict resolution keeps the new ticket App/index/styles as the primary entry
and the current main App/index/styles as the separate legacy entry. Ticket API,
workflow storage, conditional Blob writes, and the hosted response-persistence fix
are retained from the previously deployed source. No production data is reset or
migrated as part of branch publication.

This is a review branch, not a production release. Publication does not authorize
merging or changing the live site. The existing main production deployment remains
`dpl_65nThuEGMra4kVck3u1U4y9dYFaC`.
