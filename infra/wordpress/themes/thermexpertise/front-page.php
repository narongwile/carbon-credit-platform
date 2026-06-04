<?php
/**
 * Front page template.
 *
 * The sections below are the STRUCTURE migrated from the Wix homepage. Each
 * "TODO (real content)" marker must be replaced with the actual text/images
 * crawled from https://thermexpertisethex.wixsite.com/thermexpertise once the
 * environment's network policy permits fetching the site.
 *
 * @package ThermExpertise
 */

get_header();
?>

<!-- ============================ HERO ============================ -->
<section class="hero">
	<div class="container hero__inner">
		<div class="hero__copy">
			<p class="eyebrow"><?php esc_html_e( 'Thermography &amp; Thermal Imaging Experts', 'thermexpertise' ); ?></p>
			<h1 class="hero__title">
				<?php
				/* TODO (real content): replace with the Wix hero headline. */
				echo esc_html( get_bloginfo( 'name' ) );
				?>
			</h1>
			<p class="hero__lede">
				<?php /* TODO (real content): Wix hero subheading / tagline. */ ?>
				<?php esc_html_e( 'Predictive infrared inspection for electrical, mechanical and building systems.', 'thermexpertise' ); ?>
			</p>
			<div class="hero__actions">
				<a class="btn btn--accent" href="#contact"><?php esc_html_e( 'Request a Survey', 'thermexpertise' ); ?></a>
				<a class="btn btn--ghost" href="#services"><?php esc_html_e( 'Our Services', 'thermexpertise' ); ?></a>
			</div>
		</div>
	</div>
</section>

<!-- ========================== SERVICES ========================== -->
<section class="section" id="services">
	<div class="container">
		<header class="section__head">
			<p class="eyebrow"><?php esc_html_e( 'What we do', 'thermexpertise' ); ?></p>
			<h2 class="section__title"><?php esc_html_e( 'Services', 'thermexpertise' ); ?></h2>
		</header>

		<?php
		/*
		 * TODO (real content): render the real service cards from the Wix site.
		 * Recommended: create a "Service" custom post type (see inc/) or use a
		 * page with child pages, then loop here. Placeholder structure below.
		 */
		$placeholder_services = array(
			array( 'title' => __( 'Electrical Thermography', 'thermexpertise' ), 'desc' => '' ),
			array( 'title' => __( 'Mechanical / Rotating Equipment', 'thermexpertise' ), 'desc' => '' ),
			array( 'title' => __( 'Building &amp; Energy Survey', 'thermexpertise' ), 'desc' => '' ),
		);
		?>
		<div class="card-grid">
			<?php foreach ( $placeholder_services as $svc ) : ?>
				<article class="card">
					<h3 class="card__title"><?php echo esc_html( $svc['title'] ); ?></h3>
					<p class="card__desc"><?php echo $svc['desc'] ? esc_html( $svc['desc'] ) : esc_html__( 'TODO: service description from Wix.', 'thermexpertise' ); ?></p>
				</article>
			<?php endforeach; ?>
		</div>
	</div>
</section>

<!-- ============================ ABOUT =========================== -->
<section class="section section--alt" id="about">
	<div class="container about">
		<div class="about__copy">
			<p class="eyebrow"><?php esc_html_e( 'About us', 'thermexpertise' ); ?></p>
			<h2 class="section__title"><?php esc_html_e( 'About ThermExpertise', 'thermexpertise' ); ?></h2>
			<p>
				<?php /* TODO (real content): About text from the Wix site. */ ?>
				<?php esc_html_e( 'TODO: replace with the company description from the Wix “About” section.', 'thermexpertise' ); ?>
			</p>
		</div>
	</div>
</section>

<!-- =========================== CONTACT ========================== -->
<section class="section" id="contact">
	<div class="container">
		<header class="section__head">
			<p class="eyebrow"><?php esc_html_e( 'Get in touch', 'thermexpertise' ); ?></p>
			<h2 class="section__title"><?php esc_html_e( 'Contact', 'thermexpertise' ); ?></h2>
		</header>

		<div class="contact">
			<ul class="contact__list">
				<?php if ( $p = thex_contact( 'thex_phone' ) ) : ?>
					<li><strong><?php esc_html_e( 'Phone', 'thermexpertise' ); ?>:</strong> <a href="tel:<?php echo esc_attr( preg_replace( '/\s+/', '', $p ) ); ?>"><?php echo esc_html( $p ); ?></a></li>
				<?php endif; ?>
				<?php if ( $e = thex_contact( 'thex_email' ) ) : ?>
					<li><strong><?php esc_html_e( 'Email', 'thermexpertise' ); ?>:</strong> <a href="mailto:<?php echo esc_attr( $e ); ?>"><?php echo esc_html( $e ); ?></a></li>
				<?php endif; ?>
				<?php if ( $a = thex_contact( 'thex_address' ) ) : ?>
					<li><strong><?php esc_html_e( 'Address', 'thermexpertise' ); ?>:</strong> <?php echo esc_html( $a ); ?></li>
				<?php endif; ?>
			</ul>
			<?php
			/* TODO: embed the contact form. The Wix form should be recreated with
			   Contact Form 7 / WPForms, then output via [contact-form-7 ...] here. */
			if ( shortcode_exists( 'contact-form-7' ) ) {
				echo do_shortcode( '[contact-form-7 title="ThermExpertise Contact"]' );
			}
			?>
		</div>
	</div>
</section>

<?php
get_footer();
