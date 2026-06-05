<?php
/**
 * Front page — homepage of THERM Expertise.
 *
 * @package thermexpertise
 */

$thex     = thex_company();
$services = thex_services();
$clients  = thex_clients();
get_header();
?>

<!-- Hero -->
<section class="hero">
	<div class="container">
		<span class="eyebrow"><?php esc_html_e( 'Professional Engineering Consultant', 'thermexpertise' ); ?></span>
		<h1><?php esc_html_e( 'THERM EXPERTISE CO., LTD.', 'thermexpertise' ); ?></h1>
		<p class="hero__sub"><?php esc_html_e( 'Engineering Solutions for Your Business — comprehensive industrial system solutions for Thailand and Southeast Asia.', 'thermexpertise' ); ?></p>
		<div class="hero__cta">
			<a class="btn btn--primary" href="<?php echo esc_url( home_url( '/services/' ) ); ?>"><?php esc_html_e( 'Explore Services', 'thermexpertise' ); ?> <?php echo thex_icon( 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></a>
			<a class="btn btn--ghost" href="<?php echo esc_url( home_url( '/contact/' ) ); ?>"><?php esc_html_e( 'Contact Us', 'thermexpertise' ); ?></a>
		</div>
		<div class="hero__stats">
			<div class="hero__stat"><b>10+</b><span><?php esc_html_e( 'Years of expertise', 'thermexpertise' ); ?></span></div>
			<div class="hero__stat"><b>8</b><span><?php esc_html_e( 'Service disciplines', 'thermexpertise' ); ?></span></div>
			<div class="hero__stat"><b>UNIDO · TGO</b><span><?php esc_html_e( 'Certified engineers', 'thermexpertise' ); ?></span></div>
		</div>
	</div>
</section>

<!-- Highlights -->
<section class="section">
	<div class="container">
		<div class="features">
			<div class="feature">
				<div class="feature__icon"><?php echo thex_icon( 'steam' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></div>
				<h3><?php esc_html_e( 'Industrial Services', 'thermexpertise' ); ?></h3>
				<p><?php esc_html_e( 'Steam optimization, compressed air, energy management and manufacturing improvement.', 'thermexpertise' ); ?></p>
			</div>
			<div class="feature">
				<div class="feature__icon"><?php echo thex_icon( 'farm' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></div>
				<h3><?php esc_html_e( 'Aquaponic & Smart Farm', 'thermexpertise' ); ?></h3>
				<p><?php esc_html_e( 'Sustainable agricultural technology powered by IoT integration.', 'thermexpertise' ); ?></p>
			</div>
			<div class="feature">
				<div class="feature__icon"><?php echo thex_icon( 'training' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></div>
				<h3><?php esc_html_e( 'Training Programs', 'thermexpertise' ); ?></h3>
				<p><?php esc_html_e( 'Professional development across industrial and energy sectors.', 'thermexpertise' ); ?></p>
			</div>
			<div class="feature">
				<div class="feature__icon"><?php echo thex_icon( 'iot' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></div>
				<h3><?php esc_html_e( 'IoT & Engineering', 'thermexpertise' ); ?></h3>
				<p><?php esc_html_e( 'Data-driven platforms to predict and prevent manufacturing issues.', 'thermexpertise' ); ?></p>
			</div>
		</div>
	</div>
</section>

<!-- Who we are -->
<section class="section section--soft">
	<div class="container">
		<div class="split">
			<div>
				<span class="eyebrow"><?php esc_html_e( 'Who We Are', 'thermexpertise' ); ?></span>
				<h2><?php esc_html_e( 'A team of specialized engineers, dedicated to your success', 'thermexpertise' ); ?></h2>
				<p><?php esc_html_e( 'With over a decade of extensive industry and organizational experience, ThEx has assembled a team of specialized engineers proficient in a wide range of engineering disciplines — including Steam System and Compressed Air System Optimization, HVAC Design, Energy Management and Auditing, and Productivity Process Improvement, among others.', 'thermexpertise' ); ?></p>
				<div class="pillars">
					<div class="pillar"><h4><?php esc_html_e( 'Quality Policy', 'thermexpertise' ); ?></h4><p><?php esc_html_e( 'Professional precision, punctuality, success and thoroughness.', 'thermexpertise' ); ?></p></div>
					<div class="pillar"><h4><?php esc_html_e( 'Certified', 'thermexpertise' ); ?></h4><p><?php esc_html_e( 'Internationally recognized certifications from UNIDO and TGO.', 'thermexpertise' ); ?></p></div>
				</div>
				<p style="margin-top:24px"><a class="btn btn--outline" href="<?php echo esc_url( home_url( '/about/' ) ); ?>"><?php esc_html_e( 'More about us', 'thermexpertise' ); ?> <?php echo thex_icon( 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></a></p>
			</div>
			<div class="about-card">
				<span class="role"><?php esc_html_e( 'Message from leadership', 'thermexpertise' ); ?></span>
				<p class="quote">&ldquo;<?php esc_html_e( 'Our expertise is dedicated to meeting your needs with professional precision, punctuality, success, and thoroughness.', 'thermexpertise' ); ?>&rdquo;</p>
				<div class="signature">
					<b>Suittipot S.</b>
					<span><?php esc_html_e( 'CEO / MD, Therm Expertise Co., Ltd.', 'thermexpertise' ); ?></span>
				</div>
			</div>
		</div>
	</div>
</section>

<!-- Services preview -->
<section class="section">
	<div class="container">
		<div class="section-head">
			<span class="eyebrow"><?php esc_html_e( 'Our Services', 'thermexpertise' ); ?></span>
			<h2><?php esc_html_e( 'We offer a range of services to meet your needs', 'thermexpertise' ); ?></h2>
			<p><?php esc_html_e( 'Supporting private and government organizations through enhancement projects for S-curve industries, national strategy and planning.', 'thermexpertise' ); ?></p>
		</div>
		<div class="services">
			<?php foreach ( array_slice( $services, 0, 6 ) as $i => $svc ) : ?>
				<article class="service-card">
					<span class="num"><?php echo esc_html( sprintf( '%02d', $i + 1 ) ); ?></span>
					<div class="icon"><?php echo thex_icon( $svc['icon'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></div>
					<h3><?php echo esc_html( $svc['title'] ); ?></h3>
					<p><?php echo esc_html( $svc['desc'] ); ?></p>
				</article>
			<?php endforeach; ?>
		</div>
		<div style="text-align:center;margin-top:40px">
			<a class="btn btn--primary" href="<?php echo esc_url( home_url( '/services/' ) ); ?>"><?php esc_html_e( 'View all services', 'thermexpertise' ); ?> <?php echo thex_icon( 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></a>
		</div>
	</div>
</section>

<!-- Clients -->
<section class="section section--soft">
	<div class="container">
		<div class="section-head">
			<span class="eyebrow"><?php esc_html_e( 'Trusted By', 'thermexpertise' ); ?></span>
			<h2><?php esc_html_e( 'Partners & institutions we work with', 'thermexpertise' ); ?></h2>
		</div>
		<div class="clients">
			<?php foreach ( $clients as $c ) : ?>
				<div class="client-chip"><?php echo esc_html( $c['name'] ); ?><span><?php echo esc_html( $c['sub'] ); ?></span></div>
			<?php endforeach; ?>
		</div>
	</div>
</section>

<!-- CTA -->
<section class="section">
	<div class="container">
		<div class="cta-band">
			<div>
				<h2><?php esc_html_e( 'Ready to optimize your operations?', 'thermexpertise' ); ?></h2>
				<p><?php esc_html_e( 'Talk to our consultant engineers about your steam, energy, IoT or MEP project.', 'thermexpertise' ); ?></p>
			</div>
			<a class="btn btn--ghost" href="tel:<?php echo esc_attr( $thex['phone_raw'] ); ?>"><?php echo thex_icon( 'phone' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?> <?php echo esc_html( $thex['phone'] ); ?></a>
		</div>
	</div>
</section>

<?php
get_footer();
