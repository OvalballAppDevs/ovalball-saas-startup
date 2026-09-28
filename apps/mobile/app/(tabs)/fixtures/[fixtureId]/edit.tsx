import { EditFixtureScreen } from "../../../../src/fixtures/edit-fixture-screen"

/**
 * EDIT FIXTURE'S OWN ADDRESS (owner decision: the architecture fork is resolved). Reached only from
 * Fixture Detail's own "Edit Fixture" button, which gates it on `fixture.fixture.edit` before this
 * route is ever pushed -- the screen itself re-checks the same authority regardless.
 */
export default EditFixtureScreen
