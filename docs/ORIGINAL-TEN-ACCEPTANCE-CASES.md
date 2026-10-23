# Original PRD acceptance procedures

Source: ORIGINAL-MVP-PRD.md. These are the original procedures before the team split.

 Test Case 1: Complete Main Workflow

**Steps:**

1. Students create a group.
2. The group submits a proposal and ranks three supervisors.
3. The coordinator runs matching.
4. The supervisor approves the proposal.
5. Students submit milestones and contribution statements.
6. Students submit peer ratings.
7. The Health Agent processes the group.
8. Two examiners independently submit assessments.
9. The supervisor submits marks.
10. The coordinator releases results and generates the report.

**Expected result:**

- The workflow completes in the correct order.
- The group receives an eligible supervisor.
- Marks are calculated correctly.
- Students can receive different results.
- Results remain hidden until release.
- The completed project appears in the report.

 Test Case 2: Preference-First Matching

**Steps:**

1. Create groups competing for a supervisor with limited capacity.
2. Give one first-choice group no matching tags.
3. Give one third-choice group three matching tags.
4. Run matching.
5. Test an exact tie at the same preference level.

**Expected result:**

- The first-choice group is considered before the third-choice group.
- Topic points are capped at two.
- Topics break ties only within the same preference round.
- Exact ties use the recorded seeded lottery.
- No supervisor exceeds capacity.
- Unmatched groups go to the coordinator.
- Every allocation includes an explanation.

 Test Case 3: Group and Proposal Restrictions

**Steps:**

1. A student in an active group attempts to join another.
2. A group attempts to add a fourth member.
3. A group with an active proposal attempts to submit another.
4. A group attempts to rank the same supervisor twice.
5. A group attempts to add more than three topic tags.

**Expected result:**

- Every invalid action is blocked.
- Topic tags must come from the controlled list.
- No invalid record is saved.

 Test Case 4: Proposal, Similarity, and Milestones

**Steps:**

1. Submit a proposal similar to an existing proposal.
2. Attempt to approve it without justification.
3. Approve it with justification.
4. Submit one milestone late.
5. Leave another milestone overdue.

**Expected result:**

- Similarity creates a review flag, not automatic rejection.
- Approval requires justification.
- Approval creates the project and milestones.
- Late and overdue indicators are assigned correctly.

 Test Case 5: Peer Marks and Human Review

**Steps:**

1. Submit normal peer ratings in a three-person group.
2. Verify the calculated peer mark.
3. Submit ratings differing by at least two points.
4. Create a peer/supervisor percentage difference above 30 percentage points.
5. Submit a rating in a two-person group.
6. Complete coordinator review.

**Expected result:**

- The formula is `average ÷ 5 × 10`.
- Students cannot rate themselves.
- Ratings remain confidential.
- Each specified condition creates a Pending Review flag.
- Every two-person-group peer mark requires review.
- Coordinator decisions require a reason and are recorded.

 Test Case 6: Rule-Based Health and AI Explanation

**Steps:**

1. Run the health check for a normal group.
2. Run it for a late group.
3. Run it for an overdue group with low peer ratings.
4. Inspect the risk levels before calling AI.
5. Generate AI explanations and draft messages.
6. Attempt to publish a message without supervisor approval.
7. Approve an edited message.

**Expected result:**

- Rules assign Green, Amber, or Red.
- AI cannot change the assigned level.
- AI explains the stored evidence and drafts a relevant message.
- An unapproved message is not shown to students.
- The approved message appears as an in-app notice on the group members’ dashboards.

 Test Case 7: Examiner and Final Marks

**Steps:**

1. Two examiners submit group and viva marks.
2. Give group members different viva, contribution, and peer marks.
3. Calculate final results.
4. Attempt to enter marks outside component limits.
5. Attempt to change the fixed weighting.

**Expected result:**

- Examiner marks are averaged.
- The 55/45 structure remains fixed.
- Students receive different final results.
- Calculations match the documented formula.
- Invalid marks and weighting changes are rejected.

 Test Case 8: Roles and Privacy

**Steps:**

1. A student attempts to access coordinator pages.
2. A supervisor attempts to access another supervisor’s group.
3. An examiner attempts to access an unassigned defense.
4. Examiner Two attempts to see Examiner One’s marks before submission.
5. A student attempts to read confidential peer ratings or unreleased marks.

**Expected result:**

- Unauthorized access is denied.
- Private data is not displayed.
- Examiner assessments remain independent.
- No unauthorized change is saved.

 Test Case 9: Defense and Result Controls

**Steps:**

1. Attempt to schedule a defense before milestone acceptance.
2. Attempt to schedule it before selecting Fee Paid.
3. Attempt to finalize marks before both examiners submit.
4. Attempt to finalize while a peer mark is Pending Review.
5. Attempt to view marks before release.
6. Correct a released result.

**Expected result:**

- Invalid scheduling and finalization are blocked.
- Pending reviews must be resolved.
- Marks remain hidden until release.
- Corrections require a reason and audit record.

 Test Case 10: Dashboard and Report Accuracy

**Steps:**

1. Compare matching outcomes with preference rounds and topic tie-breakers.
2. Compare dashboard totals with stored records.
3. Compare risk levels with triggered rules.
4. Confirm AI explanations do not change risk levels.
5. Generate the accreditation report.
6. Compare report totals and mark distributions with the database.
7. Test core pages on desktop and mobile sizes.

**Expected result:**

- Matching follows the documented rules.
- Dashboard and report values are correct.
- Risk levels come exclusively from the rule engine.
- AI output explains but does not determine risk.
- The report can be printed or exported.
- Core workflows remain usable across supported screen sizes.

