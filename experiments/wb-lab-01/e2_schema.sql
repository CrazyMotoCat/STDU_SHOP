-- Disposable WB-LAB-01 schema only. Every runtime uses a new synthetic database.
CREATE SCHEMA e2;
REVOKE ALL ON SCHEMA e2 FROM PUBLIC;
CREATE TABLE e2.intent (
    id integer PRIMARY KEY,
    generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
    owner text NOT NULL DEFAULT 'writer_a',
    expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '240 seconds',
    digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
    size integer NOT NULL CHECK (size > 0),
    state text NOT NULL DEFAULT 'WRITING' CHECK (state IN ('WRITING', 'COMMITTED')),
    applications integer NOT NULL DEFAULT 0 CHECK (applications BETWEEN 0 AND 1),
    UNIQUE (id, generation)
);
CREATE TABLE e2.reference (
    intent_id integer PRIMARY KEY,
    generation integer NOT NULL,
    digest text NOT NULL,
    size integer NOT NULL,
    command_key text NOT NULL UNIQUE,
    FOREIGN KEY (intent_id, generation) REFERENCES e2.intent(id, generation)
);
CREATE FUNCTION e2.finalize(
    target integer, expected_generation integer, expected_owner text,
    expected_digest text, expected_size integer, key text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    current_intent e2.intent%ROWTYPE;
    current_reference e2.reference%ROWTYPE;
    decision_time timestamptz;
BEGIN
    SELECT * INTO STRICT current_intent FROM e2.intent WHERE id = target FOR UPDATE;
    decision_time := clock_timestamp();
    SELECT * INTO current_reference FROM e2.reference WHERE intent_id = target;
    IF FOUND THEN
        IF current_reference.command_key = key
            AND current_reference.generation = expected_generation
            AND current_reference.digest = expected_digest
            AND current_reference.size = expected_size
            AND current_intent.owner = expected_owner THEN
            RETURN jsonb_build_object('outcome', 'REPLAY', 'generation', expected_generation);
        END IF;
        RETURN jsonb_build_object('outcome', 'CONFLICT');
    END IF;
    IF current_intent.generation <> expected_generation OR current_intent.owner <> expected_owner THEN
        RETURN jsonb_build_object('outcome', 'STALE');
    END IF;
    IF current_intent.state <> 'WRITING' THEN
        RETURN jsonb_build_object('outcome', 'CONFLICT');
    END IF;
    IF current_intent.expires_at <= decision_time THEN
        RETURN jsonb_build_object(
            'outcome', 'EXPIRED', 'decision_time', decision_time,
            'transaction_time', transaction_timestamp(), 'expires_at', current_intent.expires_at
        );
    END IF;
    IF current_intent.digest <> expected_digest OR current_intent.size <> expected_size THEN
        RETURN jsonb_build_object('outcome', 'HASH_OR_SIZE_MISMATCH');
    END IF;
    INSERT INTO e2.reference VALUES (target, expected_generation, expected_digest, expected_size, key);
    UPDATE e2.intent SET state = 'COMMITTED', applications = applications + 1 WHERE id = target;
    RETURN jsonb_build_object('outcome', 'COMMITTED', 'generation', expected_generation,
        'decision_time', decision_time, 'expires_at', current_intent.expires_at);
END;
$$;
REVOKE ALL ON FUNCTION e2.finalize(integer, integer, text, text, integer, text) FROM PUBLIC;
