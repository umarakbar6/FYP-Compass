FYP Supervision Portal — Final Professional MVP

 1. Product Overview

The FYP Supervision Portal is a web-based system that helps universities manage the most important stages of the Final Year Project process.

The MVP focuses on four problems:

1. Supervisors are not allocated fairly.
2. Students in the same group receive identical marks despite different contributions.
3. Weak groups are identified too late.
4. Coordinators spend significant time preparing management and accreditation reports.

The MVP covers the following journey:

**Group Formation → Fair Supervisor Matching → Proposal Approval → Milestone Monitoring → Group Health Analysis → Defense Marking → Individual Results → One-Click Report**

 2. Product Pitch

> **Fair supervisor matching, individual marks for every student, early warnings from an AI-assisted Group Health Agent, and one-click accreditation reporting.**

 3. MVP Goals

The MVP will demonstrate that the portal can:

- Allocate supervisors through a transparent and preference-first matching rule.
- Prevent supervisors from exceeding their capacity.
- Track proposals and project milestones.
- record individual student contributions.
- Calculate peer-rating marks using a documented formula.
- Identify groups that may require early support.
- Use AI to explain rule-based risk results and draft supervisor messages.
- Allow supervisors and examiners to complete separate assessments.
- Give each student an individual final mark.
- Generate an accreditation report from live portal data.

 4. User Roles

 4.1 Student

A student can:

- Sign in.
- Create or join one active FYP group.
- Submit a project proposal.
- Add a title, abstract, keywords, and controlled topic tags.
- Rank three preferred supervisors.
- View the allocated supervisor and matching explanation.
- Upload milestone submissions.
- Record an individual contribution statement for each milestone.
- Complete confidential peer ratings.
- Receive approved Group Health notices on the dashboard.
- View proposal and milestone statuses.
- View released feedback and individual marks.
- View defense information.

A student cannot:

- Select a supervisor directly.
- Join more than one active group.
- View another group’s private information.
- View confidential ratings submitted by other students.
- View marks before their release.
- Submit supervisor or examiner marks.

 4.2 Supervisor

A supervisor can:

- Sign in.
- Define project-topic interests.
- View allocated groups.
- Review proposals.
- Approve, reject, or request changes.
- Review internal similarity results.
- Review milestone submissions.
- Provide milestone feedback.
- Review individual contribution statements.
- Submit supervisor-controlled marks.
- View rule-based project-health results.
- Review AI-generated explanations and draft messages.
- Approve, edit, or reject Health Agent messages.

A supervisor cannot:

- Accept more groups than their configured capacity.
- Claim groups before matching.
- Change examiner marks.
- Release final results.
- Access projects allocated to another supervisor.
- Allow AI to determine marks or project risk levels.

 4.3 Examiner

An examiner can:

- Sign in.
- View assigned defenses.
- View permitted proposal, report, and project information.
- Submit final-report and implementation marks.
- Submit a separate viva mark for every student.
- Add assessment comments.
- Finalize their assessment.

An examiner cannot:

- Access an unassigned defense.
- View the other examiner’s marks before submitting.
- Change supervisor marks.
- Access confidential peer ratings.
- Release final results.

 4.4 Department Coordinator

The coordinator can:

- Manage the active FYP session.
- Manage demo user accounts.
- Configure supervisor capacities and topic interests.
- Manage the controlled list of topic tags.
- Start the supervisor-matching process.
- Confirm proposed allocations.
- Reassign a group with a recorded reason.
- Configure milestones and deadlines.
- View all department projects.
- Review similarity and project-health flags.
- Review peer marks requiring human verification.
- Mark the defense fee as paid or unpaid.
- Schedule defenses without room management.
- Assign two examiners.
- Review completed assessments.
- Release final results.
- Generate the accreditation report.
- View the coordinator dashboard.

 5. Main MVP Workflow

 Stage 1: Session Setup

The coordinator:

1. Creates the active FYP session.
2. Defines proposal and milestone deadlines.
3. Creates the controlled list of topic tags.
4. Sets each supervisor’s capacity.
5. Records each supervisor’s topic interests.
6. Activates the fixed 55/45 marking structure.

 Stage 2: Group and Proposal Submission

1. Students form groups of one to three members.
2. Each group submits one active proposal.
3. The proposal contains:
   - Project title
   - Abstract
   - Keywords
   - Up to three topic tags
   - Optional proposal document
4. Topic tags must be selected from the coordinator-controlled list.
5. A group cannot create arbitrary tags or select extra tags to manipulate matching.
6. The group ranks three different supervisors.
7. The system performs internal similarity screening.
8. The proposal waits for batch supervisor allocation.

 6. Fair Supervisor Matching

Matching runs after the proposal deadline. Allocation is not based on submission time.

 6.1 Preference Points

| Student preference | Preference points |
|---|---:|
| First-choice supervisor | 3 |
| Second-choice supervisor | 2 |
| Third-choice supervisor | 1 |

Preference points determine allocation priority.

A first choice is always considered before a second choice, and a second choice is always considered before a third choice. Topic tags cannot cause a lower preference to outrank a higher preference.

 6.2 Topic-Match Points

A group receives one topic-match point for each shared topic tag, capped at two points.

| Shared topic tags | Topic-match points |
|---|---:|
| No shared tags | 0 |
| One shared tag | 1 |
| Two or more shared tags | 2 |

Topic-match points are used only to break ties between groups competing for the same supervisor at the same preference level.

They are not added in a way that allows a third choice to defeat another group’s first choice.

 6.3 Matching Process

The matching algorithm runs in three rounds.

 Round 1: First Choices

1. All unallocated groups compete for their first-choice supervisor.
2. Groups are ordered by topic-match points.
3. Available places are assigned up to the supervisor’s capacity.
4. Any exact tie uses a recorded seeded lottery.

 Round 2: Second Choices

1. Groups not allocated in Round 1 compete for their second choice.
2. Only supervisors with remaining capacity are considered.
3. Topic-match points break ties.
4. Any remaining tie uses the recorded seeded lottery.

 Round 3: Third Choices

1. Remaining groups compete for their third choice.
2. Only supervisors with remaining capacity are considered.
3. Topic-match points break ties.
4. Any remaining tie uses the recorded seeded lottery.

After Round 3:

- A group can have only one supervisor.
- A supervisor cannot exceed capacity.
- Remaining groups are placed in the coordinator’s Unmatched Groups list.
- The coordinator can allocate or reassign an unmatched group.
- Manual allocation or reassignment requires a written reason.

 6.4 Matching Explanation

Every allocation displays a human-readable explanation.

Example:

> “This group was allocated to Dr. Ahmed in the second-choice round. The group and supervisor share two topic tags, and Dr. Ahmed had one available position.”

The system also records:

- Preference round.
- Shared topic count.
- Topic-match points.
- Supervisor capacity before allocation.
- Whether a lottery tie-breaker was used.
- Whether the result was manually changed.

 7. Proposal Review

The allocated supervisor can:

- Approve the proposal.
- Request changes.
- Reject the proposal.

A comment is required when requesting changes or rejecting.

When a proposal is approved:

- An active project is created.
- Required milestones are generated.
- The group can submit milestone work.

A similarity flag does not automatically reject a proposal. The supervisor must review the result and provide a reason before approving a highly similar proposal.

 8. Milestones and Contribution Evidence

For each milestone:

1. The group uploads the required file.
2. Each student adds an individual contribution statement.
3. The system records whether the submission is On Time, Late, or Overdue.
4. The supervisor reviews the work.
5. The supervisor accepts it or requests rework.
6. The supervisor records feedback.

Milestone workflow statuses:

- Not Started
- Submitted
- Needs Rework
- Accepted

Timing indicators:

- On Time
- Late
- Overdue

Timing is stored separately from workflow status. A milestone can therefore be both `Submitted` and `Late`.

 9. Fixed Marking Plan

The MVP uses one fixed marking structure:

- **Group component: 55 marks**
- **Individual component: 45 marks**
- **Total: 100 marks**

The weighting cannot be changed in the MVP.

 9.1 Group Component — 55 Marks

| Component | Assessed by | Maximum |
|---|---|---:|
| Proposal and problem definition | Supervisor | 10 |
| Milestone progress and documentation | Supervisor | 15 |
| Final report | Two examiners | 15 |
| Implementation and demonstration | Two examiners | 15 |
| **Total group component** |  | **55** |

The portal averages both examiners’ marks for the examiner-controlled group components.

 9.2 Individual Component — 45 Marks

| Component | Assessed by | Maximum |
|---|---|---:|
| Individual viva | Two examiners | 20 |
| Individual contribution | Supervisor | 15 |
| Peer rating | Other group members | 10 |
| **Total individual component** |  | **45** |

The portal averages both examiners’ individual viva marks.

 9.3 Peer-Rating Method

Each student confidentially rates every other group member from 1 to 5.

The rating considers:

- Contribution to project work.
- Reliability and task completion.
- Cooperation with the group.
- Understanding of the submitted work.

Students cannot rate themselves.

The portal calculates:

**Peer Mark = Average Received Rating ÷ 5 × 10**

Example:

- Received ratings: 4 and 5
- Average: 4.5
- Peer mark: 4.5 ÷ 5 × 10
- Final peer mark: 9/10

 9.4 Peer-Rating Review Rules

A peer mark becomes `Pending Review` when any of the following occurs:

1. The group contains only two students.
2. The highest and lowest ratings received differ by 2 or more points.
3. The student’s average rating is below 2.5.
4. A required group member does not submit a rating.
5. The peer-mark percentage and supervisor-contribution percentage differ by more than 30 percentage points.

The comparison uses:

**Peer Percentage = Peer Mark ÷ 10 × 100**

**Supervisor Contribution Percentage = Supervisor Contribution Mark ÷ 15 × 100**

Example:

- Peer mark: 9/10 = 90%
- Supervisor contribution: 8/15 = 53.33%
- Difference: 36.67 percentage points
- Result: Coordinator review required

For a two-person group, one teammate’s rating alone cannot become the final peer mark. It is always reviewed by the coordinator.

For a one-person project, no peer rating exists. The coordinator assigns the peer component after reviewing contribution evidence and supervisor feedback.

 9.5 Coordinator Peer Review

When a peer mark requires review:

1. The calculated mark is temporarily locked.
2. The coordinator reviews:
   - Submitted ratings
   - Individual contribution statements
   - Supervisor feedback
   - Supervisor contribution mark
3. The coordinator can:
   - Confirm the calculated peer mark
   - Exclude a clearly invalid rating
   - Assign a reviewed mark with justification
4. A written reason is mandatory.
5. Original ratings and the final decision remain recorded.

 9.6 Final-Mark Formula

For each student:

**Final Mark = Group Component + Viva Average + Supervisor Contribution Mark + Reviewed Peer Mark**

Example:

- Group component: 46/55
- Viva average: 16/20
- Supervisor contribution: 12/15
- Peer mark: 9/10
- Final result: 83/100

Students in the same group share the group component but can receive different final results.

 9.7 Marking Safeguards

- Marks cannot be below zero.
- Marks cannot exceed component maximums.
- Both examiners submit independently.
- Examiners cannot view each other’s marks before submission.
- AI cannot calculate or change marks.
- Results cannot be finalized while an assessment or peer review is pending.
- Students cannot see marks before release.
- Post-release corrections require a reason and audit record.

 10. Internal Similarity Screening

The portal compares proposal text with proposals stored in the prototype database.

Authorized staff can see:

- Similarity percentage.
- Closest matching proposal.
- Matching project title.
- Review status.

The feature is labelled:

> **Internal similarity screening — this result supports human review and is not a final plagiarism decision.**

A proposal exceeding the configured threshold is flagged but not automatically rejected.

 11. Group Health Agent

 11.1 Purpose

The Group Health Agent helps supervisors identify groups that may require early support.

The system’s deterministic rules decide whether a group is Green, Amber, or Red. The AI does not select or change the risk level.

The AI is responsible only for:

- Explaining the rule-based result.
- Summarizing the supporting evidence.
- Recommending possible supervisor actions.
- Drafting a message for the group.

 11.2 Data Checked

The rule engine checks:

- Upcoming milestone deadlines.
- Late milestones.
- Overdue milestones.
- Repeated milestone rework.
- Missing contribution statements.
- Missing peer ratings.
- Peer-rating averages below 2.5.
- Peer-rating differences of 2 or more.
- A difference greater than 30 percentage points between peer and supervisor contribution results.

 11.3 Rule-Based Risk Levels

 Green — Normal Progress

Assigned when:

- Required milestones are on time.
- No milestone is overdue.
- Contribution statements are complete.
- Peer-rating data has no active warning.

 Amber — Attention Required

Assigned when one or more non-critical warnings exist, such as:

- A deadline is within three days without submission.
- A milestone was submitted late.
- A contribution statement is missing.
- Peer-rating submissions are incomplete.
- A milestone repeatedly needs rework.

 Red — High Risk

Assigned when one or more serious warnings exist, such as:

- A milestone is overdue.
- Multiple milestones have been missed.
- A peer-rating average is below 2.5.
- Peer and supervisor contribution results differ by more than 30 percentage points.
- Several Amber warnings occur together.

The exact triggered rules are stored with every result.

 11.4 Agent Workflow

1. A weekly schedule or manual demo action starts the health check.
2. The rule engine examines milestone and peer-rating data.
3. The rules assign Green, Amber, or Red.
4. The fixed risk result and supporting evidence are sent to the AI.
5. The AI generates:
   - A plain-language explanation
   - Recommended supervisor actions
   - A draft student message
6. The result is saved as a Group Health Report.
7. The supervisor reviews the report.
8. The supervisor can:
   - Approve the message
   - Edit and approve the message
   - Reject the message
9. Only an approved message becomes an in-app notice.
10. The notice appears on the dashboards of all students in the group.

 11.5 In-App Health Notice

The student notice displays:

- Notice title.
- Supervisor-approved message.
- Date and time.
- Supervisor name.
- Read or unread status.

No email is sent in the MVP.

 11.6 Example Agent Output

> **Rule-based risk level:** Amber  
> **Triggered rules:** Late milestone and missing contribution statement  
> **AI explanation:** The literature-review milestone was submitted four days late, and one student has not recorded their contribution.  
> **Recommended action:** Review the group’s task distribution before the next milestone.  
> **Draft notice:** “Your literature-review milestone was submitted late, and one contribution record is incomplete. Please complete the missing record and review how the next milestone tasks are divided.”

The AI cannot change the Amber risk level. The notice remains private until the supervisor approves it.

 12. Defense and Examiner Assessment

1. All required milestones must be accepted.
2. The coordinator marks the Fee Paid checkbox.
3. The coordinator schedules the defense date and time.
4. Room management is not included.
5. The coordinator assigns two examiners.
6. Each examiner independently submits:
   - Final-report mark
   - Implementation and demonstration mark
   - Individual viva mark for every student
   - Assessment comments
7. The portal averages both examiners’ marks.
8. The supervisor submits proposal, milestone, and individual-contribution marks.
9. Peer marks are calculated and reviewed where required.
10. The coordinator verifies and releases the results.

 13. One-Click Accreditation Report

The coordinator can generate a report directly from portal records.

The report includes:

- FYP session information.
- Total students and groups.
- Project titles and topic areas.
- Supervisor preferences and final allocations.
- First-, second-, and third-choice allocation rates.
- Unmatched and manually reassigned groups.
- Supervisor capacities and workloads.
- Proposal statuses.
- Milestone-completion statistics.
- On-time, late, and overdue submissions.
- Green, Amber, and Red group counts.
- Triggered Group Health rules.
- Supervisor and examiner assignments.
- Group and individual marking breakdowns.
- Final-result distribution.
- Project-completion rate.
- References to proposal, report, and assessment evidence.

For the MVP, the report is available as a printable web report with PDF export where supported.

CLO/PLO mapping is not included.

 14. Dashboards

 Student Dashboard

- Proposal status.
- Supervisor preferences.
- Allocated supervisor.
- Matching explanation.
- Milestone progress.
- Next deadline.
- Contribution-statement status.
- Peer-rating completion status.
- Approved Group Health notices.
- Defense information.
- Released mark breakdown.

 Supervisor Dashboard

- Capacity and allocated groups.
- Pending proposal reviews.
- Pending milestone reviews.
- Late and overdue milestones.
- Green, Amber, and Red groups.
- Health reports awaiting review.
- Missing contribution statements.
- Pending marking tasks.

 Examiner Dashboard

- Assigned defenses.
- Pending assessments.
- Completed assessments.
- Final-report and implementation rubrics.
- Separate viva forms for each student.

 Coordinator Dashboard

- Submitted and unallocated groups.
- Supervisor capacity and workload.
- First-, second-, and third-choice allocation rates.
- Unmatched groups.
- Proposal and milestone statuses.
- Green, Amber, and Red groups.
- Pending peer-mark reviews.
- Missing assessments.
- Scheduled defenses.
- Result distribution.
- One-click report action.

 15. Demo Data

The prototype includes:

- One department.
- One active FYP session.
- One coordinator.
- Four supervisors with different capacities and topic interests.
- Four examiners.
- Twelve to eighteen students.
- Five or six groups.
- Different preference combinations.
- A first-choice allocation.
- A second- or third-choice allocation.
- An unmatched or manually reassigned group.
- A seeded-lottery tie.
- Proposals in different states.
- One similarity-flagged proposal.
- On-time, late, and overdue milestones.
- Green, Amber, and Red groups.
- Unequal contributions within one group.
- A two-person group requiring peer-mark review.
- A peer/supervisor difference above 30 percentage points.
- Pending and completed examiner assessments.
- A completed group whose students receive different results.
- An approved in-app Group Health notice.

 16. Ten MVP Test Cases

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

 17. Four-Day Development Plan

 Day 1 — Foundation and Matching

- Database and demo data.
- Authentication and roles.
- Groups and proposals.
- Controlled topic tags.
- Preference-first matching.
- Capacity controls and allocation explanations.

 Day 2 — Milestones and Individual Marks

- Proposal review.
- Project and milestone creation.
- File uploads.
- Contribution statements.
- Peer-rating calculation.
- Review rules.
- Fixed 55/45 marking structure.

 Day 3 — Health Agent and Defense

- Deterministic health rules.
- AI explanations and draft messages.
- Supervisor approval workflow.
- In-app student notices.
- Examiner assessments.
- Defense workflow.
- Final-mark calculation.

 Day 4 — Reporting and Stabilization

- Similarity screening.
- Dashboards.
- Accreditation report.
- Permission verification.
- Responsive improvements.
- Demo-data refinement.
- Execution of all ten tests.
- Deployment and demo preparation.

 18. Future Work

The following features are postponed:

- CLO/PLO learning-outcome mapping.
- Advanced examiner-disagreement rules.
- Room management and clash detection.
- Live GitHub integration.
- Meeting scheduling and attendance.
- Real online payments.
- Project chat.
- PWA installation.
- Native mobile applications.
- Internet-wide plagiarism detection.
- University SSO.
- Email, SMS, and WhatsApp notifications.
- Advanced allocation optimization.
- Multi-university support.
- Production compliance, monitoring, backup, and disaster recovery.

 19. You’re Done When

The MVP is complete when:

1. Students can form groups, submit proposals, select controlled topic tags, and rank three supervisors.
2. Matching follows preference rounds, uses capped topic matches only as tie-breakers, respects capacity, and explains every result.
3. Approved proposals create projects and milestones with correct timing indicators.
4. Students can submit milestone files, contribution statements, and confidential peer ratings.
5. Peer marks use the documented formula, and two-person or numerically disputed results require coordinator review.
6. Deterministic rules assign Green, Amber, or Red using stored evidence.
7. AI explains the fixed risk level and drafts a message without changing risk or marks.
8. Only a supervisor-approved message appears as an in-app student notice.
9. Two examiners independently submit assessments, and the fixed 55/45 formula produces individual results.
10. Results remain hidden until the coordinator releases them.
11. The coordinator can generate an accurate one-click accreditation report.
12. All ten MVP test cases pass using the prepared demo accounts and data.

 20. Prototype Disclaimer

This MVP is a professional functional prototype for mentor review and hackathon demonstration.

Supervisor matching, peer ratings, internal similarity screening, and Group Health reports are decision-support features. Authorized university staff remain responsible for allocations, interventions, marks, and final academic decisions.

A production deployment would require additional security hardening, institutional policy approval, accessibility testing, privacy review, backup and recovery procedures, performance testing, and formal user-acceptance testing.