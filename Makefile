# Documentation generation for the test-fixture registry.
#
# Weaver is run from the pinned otel/weaver container image (the same tag the
# vendored JSON schema and `scripts/check-registry.mjs` track), so contributors
# and CI need only Docker -- no host-installed Weaver. The repo is bind-mounted
# at /workspace and that is the working directory, so every relative path below
# resolves the same way it would for a host-installed weaver.

# Single source of truth for the Weaver tag (scripts/weaver-version.mjs, bumped
# by Renovate). Parsed out of the ESM export so there is one place to change it.
WEAVER_VERSION := $(shell sed -n 's/.*WEAVER_VERSION = "\(.*\)".*/\1/p' scripts/weaver-version.mjs)
WEAVER_IMAGE := otel/weaver:$(WEAVER_VERSION)
WEAVER := docker run --rm \
	-u $(shell id -u):$(shell id -g) \
	-v "$(CURDIR):/workspace" \
	-w /workspace \
	-e HOME=/tmp \
	$(WEAVER_IMAGE)

REGISTRY := test/fixtures/registry
DOCS := test/fixtures/docs

# Markdown templates are consumed from the shared weaver-packages repo rather
# than vendored here, so they stay in sync with the rest of the org. Weaver
# resolves a remote `-t`/--templates the same way it resolves a remote registry:
# `<repo>@<refspec>[sub-folder]`. The package lives at `templates/registry/markdown`;
# both `generate` and `update-markdown` auto-resolve the `registry/<target>` layout,
# so the sub-folder is just `[templates]` and the target is `markdown`.
# NOTE: pin to a branch or tag only -- a full commit-hash refspec makes weaver's
# git layer (gix) panic, and a short hash is rejected as an unknown ref. Override
# TEMPLATES_REF on the command line to test another ref: `make generate TEMPLATES_REF=my-branch`.
TEMPLATES_REPO ?= https://github.com/lmolkova/opentelemetry-weaver-packages
TEMPLATES_REF ?= reuse-semconv-templates
TEMPLATES := $(TEMPLATES_REPO)@$(TEMPLATES_REF)[templates]

# Pinned semantic-conventions tag used to build absolute links to upstream pages
# (e.g. recording-errors.md) that the templates emit. Override on the command
# line when bumping: `make generate SEMCONV_VERSION=v1.43.0`.
SEMCONV_VERSION ?= v1.42.0
UPSTREAM_DOCS_BASE := https://github.com/open-telemetry/semantic-conventions/blob/$(SEMCONV_VERSION)

.PHONY: generate generate-registry generate-docs clean

# Regenerate everything the fixture owns: the attribute registry pages and the
# weaver snippet tables embedded in the hand-written signal docs. CI checks that
# the committed output matches what this target produces.
generate: generate-registry generate-docs

# Generate the attribute registry pages under $(DOCS)/registry/ from the v2
# resolved registry.
generate-registry:
	$(WEAVER) registry generate \
		-r ./$(REGISTRY) \
		--v2 \
		-t '$(TEMPLATES)' \
		--param upstream_docs_base=$(UPSTREAM_DOCS_BASE) \
		markdown \
		./$(DOCS)/registry

# Refresh the weaver snippet tables embedded in the hand-written signal docs
# under $(DOCS)/ (rewritten in place between <!-- weaver ... --> / <!-- endweaver --> markers).
generate-docs:
	$(WEAVER) registry update-markdown \
		-r ./$(REGISTRY) \
		--v2 \
		-t '$(TEMPLATES)' \
		--target markdown \
		--param registry_base_url=registry/ \
		--param upstream_docs_base=$(UPSTREAM_DOCS_BASE) \
		./$(DOCS)

# Remove the generated attribute registry pages (the snippet tables live inside
# hand-written docs and are not removable without losing the prose).
clean:
	rm -rf ./$(DOCS)/registry
